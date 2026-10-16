"""Full organizer catalog export and conservative weak training preparation."""
from __future__ import annotations

import argparse
import collections
import hashlib
import gzip
import json
import re
import sqlite3
import time
from pathlib import Path

from .disk_pickle import iter_catalog
from .prepare import dump_json, key_normalized


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def connection(path):
    db = sqlite3.connect(path)
    db.executescript('PRAGMA journal_mode=WAL; PRAGMA cache_size=-16384; PRAGMA synchronous=NORMAL;')
    return db


def catalog(source, output, categories_path, limit=None):
    output.mkdir(parents=True, exist_ok=True)
    marker = output / 'catalog_complete.json'
    if marker.exists():
        print(json.dumps({'event': 'catalog_already_complete', **json.loads(marker.read_text())}), flush=True)
        return
    database = output / 'catalog.sqlite'
    scratch = output / '_pickle_memo.sqlite'
    if database.exists() or scratch.exists():
        raise FileExistsError('Incomplete catalog exists; use a new output directory or remove only incomplete stage files')
    source_path = source / 'skus.pkl'
    cats = json.loads(categories_path.read_text())
    def root(cid):
        seen = set()
        while cid in cats and cats[cid].get('@parentId'):
            if cid in seen:
                raise ValueError('Category cycle')
            seen.add(cid)
            cid = str(cats[cid]['@parentId'])
        return cid
    roots = {cid: root(cid) for cid in cats}
    db = connection(database)
    db.executescript('''
        CREATE TABLE offers(sku TEXT PRIMARY KEY, category TEXT, section TEXT, raw TEXT);
        CREATE TABLE conflicts(sku TEXT PRIMARY KEY);
        CREATE TABLE parameter_counts(name TEXT PRIMARY KEY, products INTEGER);
    ''')
    params = collections.Counter()
    section_counts = collections.Counter()
    category_counts = collections.Counter()
    started = time.monotonic()
    duplicates = 0
    total = 0
    source_sha = digest(source_path)

    def progress(count, position):
        db.commit()
        print(json.dumps({'event': 'catalog_progress', 'offers_read': count,
                          'source_fraction': round(position / source_path.stat().st_size, 5),
                          'elapsed_seconds': round(time.monotonic() - started, 1)}, ensure_ascii=False), flush=True)

    try:
        for offer in iter_catalog(source_path, scratch, limit=limit, progress=progress):
            total += 1
            sku = str(offer['@id'])
            cid = str(offer.get('categories', {}).get('categoryId', ''))
            rid = roots.get(cid, '__unknown__')
            raw = json.dumps(offer, ensure_ascii=False, separators=(',', ':'))
            cursor = db.execute('INSERT OR IGNORE INTO offers VALUES(?,?,?,?)', (sku, cid, rid, raw))
            if cursor.rowcount == 0:
                duplicates += 1
                previous = db.execute('SELECT raw FROM offers WHERE sku=?', (sku,)).fetchone()[0]
                if previous != raw:
                    db.execute('INSERT OR IGNORE INTO conflicts VALUES(?)', (sku,))
                continue
            section_counts[rid] += 1
            category_counts[cid] += 1
            fields = offer.get('param', [])
            if isinstance(fields, dict):
                fields = [fields]
            names = {key_normalized(p.get('@name', '')).removesuffix('_search') for p in fields
                     if isinstance(p, dict) and p.get('@name')}
            params.update(names)
        db.executemany('INSERT INTO parameter_counts VALUES(?,?)', params.items())
        db.execute('CREATE INDEX section_idx ON offers(section)')
        db.commit()
        conflict_count = db.execute('SELECT COUNT(*) FROM conflicts').fetchone()[0]
        unique = db.execute('SELECT COUNT(*) FROM offers').fetchone()[0]
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        summary = {'source_sha256': source_sha, 'offers_read': total, 'unique_skus': unique,
                   'duplicate_sku_records': duplicates, 'conflicting_skus_excluded_later': conflict_count,
                   'sections': dict(section_counts), 'categories': dict(category_counts),
                   'parameter_names': len(params), 'elapsed_seconds': time.monotonic() - started,
                   'selection': 'bounded_catalog_prefix' if limit and total >= limit else 'entire_catalog_reached_STOP',
                   'limit_offers': limit, 'source': str(source_path)}
        dump_json(output / 'categories.json', cats)
        dump_json(marker, summary)
        print(json.dumps({'event': 'catalog_complete', 'offers': total, 'unique_skus': unique,
                          'seconds': summary['elapsed_seconds']}, ensure_ascii=False), flush=True)
    finally:
        db.close()
    # Only disposable interpreter storage is deleted, and only after success.
    scratch.unlink()


def finalize_prefix(source, output, categories_path):
    """Explicitly finalize committed rows after interrupting an expensive scan.

    This never describes an interrupted prefix as a full-catalog sample.
    It is useful for a short demo; a new full scan remains a separate operation.
    """
    marker = output / 'catalog_complete.json'
    if marker.exists():
        return
    db = connection(output / 'catalog.sqlite')
    params, sections, categories = collections.Counter(), collections.Counter(), collections.Counter()
    for cid, section, raw in db.execute('SELECT category,section,raw FROM offers'):
        sections[section] += 1
        categories[cid] += 1
        fields = json.loads(raw).get('param', [])
        if isinstance(fields, dict):
            fields = [fields]
        params.update({key_normalized(p.get('@name', '')).removesuffix('_search') for p in fields
                       if isinstance(p, dict) and p.get('@name')})
    db.execute('DELETE FROM parameter_counts')
    db.executemany('INSERT INTO parameter_counts VALUES(?,?)', params.items())
    db.execute('CREATE INDEX IF NOT EXISTS section_idx ON offers(section)')
    db.commit()
    conflicts = db.execute('SELECT COUNT(*) FROM conflicts').fetchone()[0]
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    dump_json(output / 'categories.json', json.loads(categories_path.read_text()))
    summary = {'selection': 'bounded_catalog_prefix', 'unique_skus': sum(sections.values()),
               'sections': dict(sections), 'categories': dict(categories),
               'parameter_names': len(params), 'conflicting_skus_excluded_later': conflicts,
               'source_sha256': digest(source / 'skus.pkl'), 'source': str(source / 'skus.pkl'),
               'full_catalog_reached_STOP': False, 'finalization': 'committed_prefix_after_explicit_interrupt'}
    dump_json(marker, summary)
    scratch = output / '_pickle_memo.sqlite'
    if scratch.exists():
        scratch.unlink()
    print(json.dumps({'event': 'prefix_finalized', 'skus': summary['unique_skus']}), flush=True)


def join_descriptions(source, output):
    import pyarrow.parquet as pq
    marker = output / 'descriptions_complete.json'
    if marker.exists():
        return
    db = connection(output / 'catalog.sqlite')
    db.executescript('''
        DROP TABLE IF EXISTS descriptions;
        DROP TABLE IF EXISTS description_conflicts;
        CREATE TABLE descriptions(sku TEXT PRIMARY KEY,title TEXT,description TEXT);
        CREATE TABLE description_conflicts(sku TEXT PRIMARY KEY);
    ''')
    wanted = {row[0] for row in db.execute('SELECT sku FROM offers')}
    source_path = source / 'sku_desc.parquet'
    rows_read = matches = duplicates = 0
    started = time.monotonic()
    for batch in pq.ParquetFile(source_path).iter_batches(batch_size=1024, columns=['sku_id', 'title', 'description']):
        for row in batch.to_pylist():
            rows_read += 1
            sku = str(row['sku_id'])
            if sku not in wanted:
                continue
            values = (sku, row['title'] or '', row['description'] or '')
            cursor = db.execute('INSERT OR IGNORE INTO descriptions VALUES(?,?,?)', values)
            if cursor.rowcount:
                matches += 1
            else:
                duplicates += 1
                old = db.execute('SELECT title,description FROM descriptions WHERE sku=?', (sku,)).fetchone()
                if old != values[1:]:
                    db.execute('INSERT OR IGNORE INTO description_conflicts VALUES(?)', (sku,))
        if rows_read % 65536 == 0:
            db.commit()
            print(json.dumps({'event': 'descriptions', 'rows_read': rows_read, 'matched_skus': matches}), flush=True)
    db.commit()
    conflicts = db.execute('SELECT COUNT(*) FROM description_conflicts').fetchone()[0]
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    dump_json(marker, {'source_sha256': digest(source_path), 'rows_read': rows_read, 'matched_skus': matches,
                      'duplicate_rows': duplicates, 'conflicting_descriptions_excluded': conflicts,
                      'elapsed_seconds': time.monotonic() - started})


class Groups:
    def __init__(self):
        self.parent = {}

    def find(self, key):
        self.parent.setdefault(key, key)
        root = key
        while self.parent[root] != root:
            root = self.parent[root]
        while key != root:
            nxt = self.parent[key]
            self.parent[key] = root
            key = nxt
        return root

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.parent[max(a, b)] = min(a, b)


def full_split(group, seed):
    bucket = int(hashlib.sha256(f'{seed}:{group}'.encode()).hexdigest()[:8], 16) % 1000
    return 'train' if bucket < 800 else 'dev' if bucket < 900 else 'test'


def prepare(output, seed=42, min_catalog_support=50, min_train_support=20):
    from .weak_labels import descriptor, targets, aligned_spans, variant_key
    from .prepare import QUERIES

    marker = output / 'dataset_complete.json'
    if marker.exists():
        return
    db = connection(output / 'catalog.sqlite')
    cats = json.loads((output / 'categories.json').read_text())
    allowed = set()
    registry = {attr: {'attribute_id': attr, 'name': name, 'catalog_names': [], 'origin': 'existing_project_id'}
                for attr, name in QUERIES.items()}
    for name, support in db.execute('SELECT name,products FROM parameter_counts WHERE products>=?', (min_catalog_support,)):
        info = descriptor(name)
        if info:
            allowed.add(name)
            if info['attribute_id'] in registry:
                registry[info['attribute_id']]['catalog_names'] += info['catalog_names']
            else:
                registry[info['attribute_id']] = info
    db.executescript('''
        DROP TABLE IF EXISTS products;
        DROP TABLE IF EXISTS example_fingerprints;
        CREATE TABLE products(sku TEXT PRIMARY KEY,group_id TEXT,split TEXT,title TEXT,description TEXT,category TEXT,section TEXT);
        CREATE TABLE example_fingerprints(fingerprint TEXT PRIMARY KEY);
    ''')
    groups, titles, product_keys = Groups(), {}, {}
    rows = db.execute('''SELECT o.sku,o.category,o.section,o.raw,d.title,d.description
        FROM offers o LEFT JOIN descriptions d ON d.sku=o.sku
        AND d.sku NOT IN (SELECT sku FROM description_conflicts)
        WHERE o.sku NOT IN (SELECT sku FROM conflicts) ORDER BY o.sku''')
    products_by_section, descriptions_clipped = collections.Counter(), 0
    for sku, cid, rid, raw, desc_title, description in rows:
        offer = json.loads(raw)
        title = desc_title or str(offer.get('name') or '')
        description = description or ''
        if len(description) > 20000:
            descriptions_clipped += 1
            description = description[:20000]
        key = variant_key(offer)
        groups.find(key)
        title_key = hashlib.sha256(key_normalized(title).encode()).hexdigest()
        if title_key in titles:
            groups.union(key, titles[title_key])
        else:
            titles[title_key] = key
        if len(description.strip()) >= 80:
            description_key = 'description:' + hashlib.sha256(key_normalized(description).encode()).hexdigest()
            if description_key in titles:
                groups.union(key, titles[description_key])
            else:
                titles[description_key] = key
        product_keys[sku] = key
        db.execute('INSERT INTO products VALUES(?,?,?,?,?,?,?)', (sku, key, '', title, description, cid, rid))
        products_by_section[rid] += 1
    del titles
    split_counts, split_groups = collections.Counter(), collections.defaultdict(set)
    for sku, key in product_keys.items():
        group = groups.find(key)
        split = full_split(group, seed)
        db.execute('UPDATE products SET group_id=?,split=? WHERE sku=?', (group, split, sku))
        split_counts[split] += 1
        split_groups[split].add(group)
    del product_keys, groups
    assert not (split_groups['train'] & split_groups['dev'] or split_groups['train'] & split_groups['test'] or split_groups['dev'] & split_groups['test'])
    db.commit()
    support = collections.defaultdict(collections.Counter)
    sections_with_spans = collections.Counter()
    dropped = collections.Counter()
    candidate_path = output / '_candidate_spans.jsonl.gz'
    started = time.monotonic()
    with gzip.open(candidate_path, 'wt', encoding='utf-8') as f:
        rows = db.execute('''SELECT p.sku,p.group_id,p.split,p.title,p.description,p.category,p.section,o.raw
                            FROM products p JOIN offers o ON p.sku=o.sku ORDER BY p.sku''')
        for i, (sku, group, split, title, description, cid, rid, raw) in enumerate(rows, 1):
            offer = json.loads(raw)
            values = targets(offer, allowed)
            for field, text in [('title', title), ('description', description)]:
                if not text.strip():
                    continue
                for attr, entry in values.items():
                    spans = aligned_spans(text, attr, entry['name'], entry['values'])
                    if not spans:
                        continue
                    if len(spans) > 30:
                        dropped['too_many_ambiguous_occurrences'] += 1
                        continue
                    fingerprint = hashlib.sha256(json.dumps([attr, text, [(s['start'], s['end']) for s in spans]], ensure_ascii=False).encode()).hexdigest()
                    cursor = db.execute('INSERT OR IGNORE INTO example_fingerprints VALUES(?)', (fingerprint,))
                    if not cursor.rowcount:
                        dropped['duplicate_attribute_text_example'] += 1
                        continue
                    row = {'product_id': sku, 'group_id': group, 'split': split, 'field': field, 'text': text,
                           'category_id': cid, 'category_name': cats.get(cid, {}).get('#text', cid),
                           'section_id': rid, 'attribute_id': attr, 'attribute_name': entry['name'],
                           'spans': spans, 'supervision': 'silver_catalog_alignment'}
                    f.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
                    support[attr][split] += 1
                    sections_with_spans[rid] += 1
            if i % 2000 == 0:
                db.commit()
                print(json.dumps({'event': 'align', 'products': i, 'positive_pairs': sum(sum(v.values()) for v in support.values()),
                                  'seconds': round(time.monotonic()-started, 1)}), flush=True)
    eligible = {a for a, counts in support.items() if counts['train'] >= min_train_support}
    for attr, info in registry.items():
        info['positive_examples'] = dict(support.get(attr, {}))
        info['trainable'] = attr in eligible
        info['annotation_quality'] = 'weak_not_human_gold'
    handles = {s: gzip.open(output / f'{s}.jsonl.gz', 'wt', encoding='utf-8') for s in ['train', 'dev', 'test']}
    actual_counts, actual_sections, actual_attrs = collections.Counter(), collections.Counter(), collections.Counter()
    try:
        with gzip.open(candidate_path, 'rt', encoding='utf-8') as f:
            for line in f:
                row = json.loads(line)
                if row['attribute_id'] not in eligible:
                    continue
                handles[row['split']].write(line)
                actual_counts[row['split']] += 1
                actual_sections[row['section_id']] += 1
                actual_attrs[row['attribute_id']] += 1
    finally:
        for handle in handles.values():
            handle.close()
    candidate_path.unlink()
    with gzip.open(output / 'product_splits.jsonl.gz', 'wt', encoding='utf-8') as f:
        for sku, group, split, cid, rid in db.execute('SELECT sku,group_id,split,category,section FROM products ORDER BY sku'):
            f.write(json.dumps({'product_id': sku, 'group_id': group, 'split': split,
                                'category_id': cid, 'section_id': rid}) + '\n')
    with (output / 'demo_cards.jsonl').open('w', encoding='utf-8') as f:
        used = set()
        for sku, title, description, cid, rid in db.execute("SELECT sku,title,description,category,section FROM products WHERE split='dev' ORDER BY sku"):
            if rid in used:
                continue
            used.add(rid)
            f.write(json.dumps({'product_id': sku, 'title': title, 'description': description,
                                'category_id': cid, 'category_name': cats.get(cid, {}).get('#text', cid),
                                'section_id': rid, 'seller_attributes': []}, ensure_ascii=False) + '\n')
            if len(used) >= 24:
                break
    db.commit()
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    dump_json(output / 'attribute_registry.json', {'version': 'demo_catalog_names_v1', 'official': False,
              'attribute_queries': {a: registry[a]['name'] for a in sorted(eligible)},
              'attributes': registry,
              'policy': 'Exact catalog names retained; only existing eight project IDs have alias mapping. New IDs need semantic review before production.'})
    hashes = {name: digest(output / name) for name in ['train.jsonl.gz', 'dev.jsonl.gz', 'test.jsonl.gz',
                                                      'product_splits.jsonl.gz', 'attribute_registry.json', 'demo_cards.jsonl']}
    summary = {'selection': json.loads((output/'catalog_complete.json').read_text())['selection'],
               'products': sum(split_counts.values()), 'products_by_split': dict(split_counts),
               'positive_examples_by_split': dict(actual_counts), 'attributes_with_training_support': len(eligible),
               'catalog_parameter_min_products': min_catalog_support, 'min_train_positive_pairs': min_train_support,
               'products_by_section': dict(products_by_section), 'positive_examples_by_section': dict(actual_sections),
               'positive_examples_by_attribute': dict(actual_attrs), 'supervision': 'silver_catalog_alignment',
               'test_used_for_selection_or_calibration': False, 'group_overlap': 0, 'seed': seed,
               'split_policy': '80/10/10 hash of connected vendor/model variants, normalized titles and descriptions >=80 characters',
               'descriptions_clipped_at_20000_chars': descriptions_clipped, 'dropped': dict(dropped),
               'sha256': hashes, 'elapsed_alignment_seconds': time.monotonic()-started,
               'limitations': ['Catalog prefix is not representative of the entire catalog.',
                              'Attribute spans are automatically aligned; no human gold or verified negative pairs.',
                              'New attribute IDs preserve catalog field names, not a fully reconciled leaf taxonomy.',
                              'Only attributes with observed positive training support are enabled.',
                              'Approximate variant grouping needs an audit before final evaluation.']}
    dump_json(marker, summary)
    print(json.dumps({'event': 'dataset_complete', 'products': summary['products'],
                      'examples': dict(actual_counts), 'attributes': len(eligible)}, ensure_ascii=False), flush=True)


def consolidate_text_groups(output, seed=42, min_train_support=20):
    """Upgrade a prepared pilot so repeated description text cannot cross splits."""
    summary_path = output/'dataset_complete.json'
    summary = json.loads(summary_path.read_text())
    if 'descriptions >=80' in summary['split_policy']:
        return
    db=connection(output/'catalog.sqlite')
    groups, seen, sku_groups=Groups(),{},{}
    for sku,group,title,description in db.execute('SELECT sku,group_id,title,description FROM products'):
        groups.find(group)
        for field,text in [('title',title),('description',description)]:
            if not text or (field=='description' and len(text.strip())<80):
                continue
            key=(field,hashlib.sha256(key_normalized(text).encode()).hexdigest())
            if key in seen:
                groups.union(group,seen[key])
            else:
                seen[key]=group
        sku_groups[sku]=group
    mapping={sku:(groups.find(group),full_split(groups.find(group),seed)) for sku,group in sku_groups.items()}
    for sku,(group,split) in mapping.items():
        db.execute('UPDATE products SET group_id=?,split=? WHERE sku=?',(group,split,sku))
    db.commit()
    counts=collections.defaultdict(collections.Counter)
    temporary=output/'_regrouped.jsonl.gz'
    with gzip.open(temporary,'wt',encoding='utf-8') as target:
        for split in ['train','dev','test']:
            with gzip.open(output/f'{split}.jsonl.gz','rt',encoding='utf-8') as f:
                for line in f:
                    row=json.loads(line)
                    row['group_id'],row['split']=mapping[row['product_id']]
                    counts[row['attribute_id']][row['split']]+=1
                    target.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
    eligible={a for a,c in counts.items() if c['train']>=min_train_support}
    handles={s:gzip.open(output/f'{s}.regroup.jsonl.gz','wt',encoding='utf-8') for s in ['train','dev','test']}
    actual,sections,attributes=collections.Counter(),collections.Counter(),collections.Counter()
    try:
        with gzip.open(temporary,'rt',encoding='utf-8') as f:
            for line in f:
                row=json.loads(line)
                if row['attribute_id'] not in eligible:
                    continue
                handles[row['split']].write(line)
                actual[row['split']]+=1
                sections[row['section_id']]+=1
                attributes[row['attribute_id']]+=1
    finally:
        for handle in handles.values():
            handle.close()
    for split in handles:
        (output/f'{split}.regroup.jsonl.gz').replace(output/f'{split}.jsonl.gz')
    temporary.unlink()
    registry=json.loads((output/'attribute_registry.json').read_text())
    for attr,info in registry['attributes'].items():
        info['support_before_text_grouping']=info['positive_examples']
        info['positive_examples']=dict(counts.get(attr,{}))
        info['trainable']=attr in eligible
    registry['attribute_queries']={a:registry['attributes'][a]['name'] for a in sorted(eligible)}
    dump_json(output/'attribute_registry.json',registry)
    with gzip.open(output/'product_splits.jsonl.gz','wt',encoding='utf-8') as f:
        for sku,group,split,cid,rid in db.execute('SELECT sku,group_id,split,category,section FROM products ORDER BY sku'):
            f.write(json.dumps({'product_id':sku,'group_id':group,'split':split,'category_id':cid,'section_id':rid})+'\n')
    cats=json.loads((output/'categories.json').read_text())
    with (output/'demo_cards.jsonl').open('w',encoding='utf-8') as f:
        seen=set()
        for sku,title,description,cid,rid in db.execute("SELECT sku,title,description,category,section FROM products WHERE split='dev' ORDER BY sku"):
            if rid in seen:
                continue
            seen.add(rid)
            f.write(json.dumps({'product_id':sku,'title':title,'description':description,'category_id':cid,
                                'category_name':cats.get(cid,{}).get('#text',cid),'section_id':rid,'seller_attributes':[]},ensure_ascii=False)+'\n')
            if len(seen)>=24:
                break
    summary.update(products_by_split=dict(collections.Counter(split for _,split in mapping.values())),
                   positive_examples_by_split=dict(actual),positive_examples_by_section=dict(sections),
                   positive_examples_by_attribute=dict(attributes),attributes_with_training_support=len(eligible),
                   split_policy='80/10/10 hash of connected vendor/model variants, normalized titles and descriptions >=80 characters')
    summary['sha256']={name:digest(output/name) for name in summary['sha256']}
    dump_json(summary_path,summary)
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    print(json.dumps({'event':'text_groups_consolidated','examples':dict(actual),'attributes':len(eligible)}),flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, default=Path('cu_ws'))
    p.add_argument('--output', type=Path, default=Path('data/participant3_full'))
    p.add_argument('--categories', type=Path, default=Path('data/participant3_demo/categories.json'))
    p.add_argument('--stage', choices=['catalog', 'finalize-prefix', 'join', 'prepare', 'regroup', 'all'], default='all')
    p.add_argument('--limit-offers', type=int, default=50000, help='0: full catalog; demo default: first 50000 offers')
    p.add_argument('--min-catalog-support', type=int, default=50)
    p.add_argument('--min-train-support', type=int, default=20)
    a = p.parse_args()
    if a.stage in {'catalog', 'all'}:
        catalog(a.source, a.output, a.categories, a.limit_offers or None)
    if a.stage == 'finalize-prefix':
        finalize_prefix(a.source, a.output, a.categories)
    if a.stage in {'join', 'all'}:
        join_descriptions(a.source, a.output)
    if a.stage in {'prepare', 'all'}:
        prepare(a.output, min_catalog_support=a.min_catalog_support, min_train_support=a.min_train_support)
    if a.stage in {'regroup', 'all'}:
        consolidate_text_groups(a.output,min_train_support=a.min_train_support)


if __name__ == '__main__':
    main()
