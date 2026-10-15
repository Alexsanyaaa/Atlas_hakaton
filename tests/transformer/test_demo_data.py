import gzip
import json
import pickle
import sqlite3

import pytest

from catalog_ai.participant3.disk_pickle import iter_catalog
from catalog_ai.participant3.object_store import AppendObjects
from catalog_ai.participant3.pickle_stream import UnsafePickleError
from catalog_ai.participant3.weak_labels import aligned_spans, targets, descriptor
from catalog_ai.participant3.full_corpus import Groups, full_split, consolidate_text_groups
from catalog_ai.training.demo import quotas, balanced_records


@pytest.mark.parametrize('protocol',[2,4,5])
def test_disk_reader_preserves_shared_containers(tmp_path,protocol):
    values=[{'@name':'Цвет','#text':'серый'}]
    offers=[{'@id':str(i),'name':f'Товар {i}','vendor':'Acme','param':values} for i in range(4)]
    path=tmp_path/'input.pkl'
    path.write_bytes(pickle.dumps({'offers':offers},protocol=protocol))
    assert list(iter_catalog(path,tmp_path/'memo'))==offers


def test_disk_reader_rejects_executable_pickle(tmp_path):
    class Bad:
        def __reduce__(self):
            return eval,('1+1',)
    path=tmp_path/'bad.pkl'
    path.write_bytes(pickle.dumps(Bad()))
    with pytest.raises(UnsafePickleError,match='opcode'):
        list(iter_catalog(path,tmp_path/'memo'))


def test_append_store_reads_evicted_shared_containers(tmp_path):
    store=AppendObjects(tmp_path/'objects',cache_size=2)
    try:
        child=store.new('dict')
        store.update(child,['x','значение'])
        parent=store.new('list')
        store.append(parent,[child,child])
        store.memo_put(0,parent)
        for i in range(1,12):
            store.new('dict')
            store.memo_put(i,f'string{i}')
        assert store.materialize(store.memo_get(0))==[{'x':'значение'},{'x':'значение'}]
        store.update(child,['y',3])
        assert store.materialize(parent)==[{'x':'значение','y':3}]*2
    finally:
        store.close()


def test_units_and_roles_prevent_false_numeric_labels():
    assert not aligned_spans('Модель S8', 'ram_gb','RAM',[('8','ГБ')])
    assert aligned_spans('ОЗУ 8GB','ram_gb','RAM',[('8','ГБ')])[0]['quote']=='8GB'
    assert not aligned_spans('Вес 10 кг','height','высота',[('10','мм')])
    assert not aligned_spans('накопитель 8 ГБ','ram_gb','RAM',[('8','ГБ')])


def test_conflicting_catalog_ram_does_not_generate_labels():
    offer={'param':[{'@name':'Оперативная память','#text':'4 ГБ'},
                    {'@name':'Оперативная память (RAM)_search','#text':'5','@unit':'ГБ'}]}
    assert 'ram_gb' not in targets(offer,{'оперативная память','оперативная память (ram)'})


def test_component_materials_keep_distinct_ids_and_marketing_excluded():
    assert descriptor('Материал корпуса')['attribute_id']!=descriptor('Материал плафона')['attribute_id']
    assert descriptor('Потратить бонусы') is None


def test_duplicate_connections_force_one_group_and_split():
    groups=Groups()
    groups.union('a','b')
    groups.union('b','c')
    assert groups.find('a')==groups.find('c')
    assert full_split(groups.find('a'),42)==full_split(groups.find('c'),42)


def test_balanced_sampler_respects_total_cap_and_rare_attributes(tmp_path):
    path=tmp_path/'train.jsonl.gz'
    with gzip.open(path,'wt',encoding='utf-8') as f:
        for attr,n in [('frequent',100),('rare',2)]:
            for i in range(n):
                f.write(json.dumps({'attribute_id':attr,'field':'title','section_id':str(i%3),'i':i})+'\n')
    rows=balanced_records(path,10,['title'],42)
    assert len(rows)==10
    assert sum(r['attribute_id']=='rare' for r in rows)==2
    assert rows==balanced_records(path,10,['title'],42)
    assert len(balanced_records(path,10,['title'],42,{'rare'}))==2
    assert sum(quotas({'a':100,'b':2,'c':4},10).values())==10


def test_repeated_descriptions_are_reassigned_together(tmp_path):
    db=sqlite3.connect(tmp_path/'catalog.sqlite')
    db.execute('CREATE TABLE products(sku TEXT,group_id TEXT,split TEXT,title TEXT,description TEXT,category TEXT,section TEXT)')
    description='Одинаковое описание товара Acme. '*5
    db.executemany('INSERT INTO products VALUES(?,?,?,?,?,?,?)',[
        ('1','a','train','Acme First',description,'cat','root'),
        ('2','b','dev','Acme Second',description,'cat','root')])
    db.commit()
    db.close()
    for split in ['train','dev','test']:
        with gzip.open(tmp_path/f'{split}.jsonl.gz','wt',encoding='utf-8') as f:
            sku={'train':'1','dev':'2'}.get(split)
            if sku:
                f.write(json.dumps({'product_id':sku,'attribute_id':'brand','section_id':'root',
                                    'group_id':sku,'split':split})+'\n')
    (tmp_path/'dataset_complete.json').write_text(json.dumps({'split_policy':'old','sha256':{
        'train.jsonl.gz':'','dev.jsonl.gz':'','test.jsonl.gz':'','product_splits.jsonl.gz':'',
        'attribute_registry.json':'','demo_cards.jsonl':''}}))
    (tmp_path/'attribute_registry.json').write_text(json.dumps({'attribute_queries':{'brand':'Бренд'},
        'attributes':{'brand':{'name':'Бренд','positive_examples':{'train':1,'dev':1},'trainable':True}}}))
    (tmp_path/'categories.json').write_text(json.dumps({'cat':{'#text':'Товары'}}))
    seed=next(i for i in range(100) if full_split('a',i)=='train')
    consolidate_text_groups(tmp_path,seed=seed,min_train_support=1)
    with gzip.open(tmp_path/'product_splits.jsonl.gz','rt',encoding='utf-8') as f:
        mapping=[json.loads(line) for line in f]
    assert len({(r['group_id'],r['split']) for r in mapping})==1
    registry=json.loads((tmp_path/'attribute_registry.json').read_text())
    assert registry['attributes']['brand']['positive_examples']=={'train':2}
