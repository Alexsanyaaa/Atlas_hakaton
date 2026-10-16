"""Versioned, auditable silver-label repairs. Never reads the test split.

Agent-authored challenge examples are not human gold. Disputed catalog labels
are repaired by explicit schema policy, not by copying model predictions.
"""
from __future__ import annotations
import argparse, collections, copy, gzip, hashlib, json, re
from pathlib import Path
from catalog_ai.participant3.prepare import QUERIES

CAPACITY = re.compile(r'\d+(?:[.,]\d+)?\s*(?:[ГМТ]Б|[GMT]B|GiB|TiB)', re.I)
SCREEN = re.compile(r'\d+(?:[.,]\d+)?\s*(?:["″]|дюйм\w*|inch\w*)', re.I)
BATTERY = re.compile(r'\d+(?:[.,]\d+)?\s*(?:мА\s*[·*]?\s*ч|mAh)', re.I)
# Full processor designation; preserve what is actually stated in the text.
CPU = re.compile(r'(?<!\w)(?:(?:Intel\s+)?Core\s+(?:Ultra\s+)?i?[3579](?:[- ]+\d{3,5}[A-Z0-9]*)?|(?:AMD\s+)?Ryzen\s+[3579](?:\s+\d{4}[A-Z0-9]*)?|(?:MediaTek\s+)?Helio\s+[A-Z]\d+(?:\s+Ultimate)?|(?:MediaTek\s+)?Dimensity\s+\d+[A-Z]*|(?:Unisoc\s+)?T\d{3,4}|(?:Qualcomm\s+)?Snapdragon\s+\d+(?:\s+Gen\s+\d+)?(?:\s*\+)?|Apple\s+M[1-9](?:\s+(?:Pro|Max|Ultra))?)(?!\w)', re.I)
COLOR_END = re.compile(r'(?i)(?:[\s,;/]+)(?:белый|белая|белое|ч[её]рный|ч[её]рная|серый|серая|ж[её]лтый|зел[её]ный|синий|красный|розовый|фиолетовый|серебристый)(?:\s+(?:глянцевый|матовый))?\s*$')


def read_rows(path):
    op = gzip.open if str(path).endswith('.gz') else open
    with op(path, 'rt', encoding='utf-8') as f:
        for line in f:
            if line.strip(): yield json.loads(line)


def write_rows(path, rows):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    op = gzip.open if str(path).endswith('.gz') else open
    with op(path, 'wt', encoding='utf-8') as f:
        for row in rows: f.write(json.dumps(row, ensure_ascii=False)+'\n')


def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1048576),b''): h.update(block)
    return h.hexdigest()


def repair_record(row, brand_spans=()):
    """Schema corrections with a reversible old/new audit trail per record."""
    r=copy.deepcopy(row); text=r['text']; attr=r['attribute_id']; kept=[]; reasons=[]
    for original in r['spans']:
        s=copy.deepcopy(original); a,b=s['start'],s['end']
        if type(a) is not int or type(b) is not int or not 0<=a<b<=len(text) or text[a:b]!=s['quote']:
            reasons.append('invalid_evidence_removed'); continue
        quote=text[a:b]
        pattern={'ram_gb':CAPACITY,'storage_gb':CAPACITY,'screen_inches':SCREEN,'battery_mah':BATTERY}.get(attr)
        if pattern and not pattern.fullmatch(quote.strip()):
            reasons.append('wrong_value_type_removed');continue
        if attr=='model':
            # Only remove a brand prefix that was independently aligned for
            # this same text, retaining at least one model character.
            for brand in brand_spans:
                if brand['start']==a and brand['end']<b and text[brand['end']:b][:1].isspace():
                    a=brand['end']
                    while a<b and text[a].isspace():a+=1
                    reasons.append('brand_prefix_separated_from_model');break
            m=COLOR_END.search(text[a:b])
            if m and m.start()>0:
                b=a+m.start();reasons.append('russian_color_suffix_separated_from_model')
        if attr=='cpu':
            matches=[m for m in CPU.finditer(text) if m.start()<b and a<m.end()]
            if len(matches)==1 and matches[0].start()<=a and b<=matches[0].end():
                m=matches[0]
                if m.span()!=(a,b):a,b=m.span();reasons.append('processor_designation_completed')
        if a>=b:reasons.append('empty_after_repair');continue
        s.update(start=a,end=b,quote=text[a:b]);kept.append(s)
    unique={(s['start'],s['end']):s for s in kept}
    r['spans']=sorted(unique.values(),key=lambda s:(s['start'],s['end']))
    if reasons:
        r['supervision']='silver_schema_repaired_v2';r['repair_reasons']=sorted(set(reasons))
    # Empty silver annotations mean unknown, never absence.
    return (r if r['spans'] else None), sorted(set(reasons))


def synthetic_records():
    """Small explicit diagnostic curriculum; every queried field fully annotated.

    Families are disjoint between training and challenge. These are invented
    texts, so their factual validity depends only on their stated contents.
    """
    rows=[]
    def add(family,text,values,split='train',category='Смартфоны'):
        pid=f'synthetic-v2-{family}'
        for attr,quotes in values.items():
            spans=[]
            for quote in quotes:
                found=list(re.finditer(re.escape(quote),text))
                if not found:raise ValueError((family,quote))
                for m in found:spans.append({'start':m.start(),'end':m.end(),'quote':m.group(),'label':attr})
            spans=list({(s['start'],s['end']):s for s in spans}.values())
            rows.append({'product_id':pid,'group_id':pid,'split':split,'field':'description','text':text,
                         'category_name':category,'category_id':'synthetic','section_id':'synthetic',
                         'attribute_id':attr,'attribute_name':QUERIES[attr],'spans':spans,
                         'annotation_complete':True,'supervision':'agent_authored_synthetic_v2',
                         'verification':'agent_authored_not_human','case_family':family.split('-')[0]})
    for i,(ram,ssd) in enumerate([(8,256),(16,512),(32,1024),(4,128),(12,256),(24,512)]):
        add(f'capacity-{i}',f'Ноутбук. Оперативная память DDR4 — {ram} ГБ, частота 3200 МГц. SSD — {ssd} ГБ. Допускается установка SSD до 2048 ГБ. Цвет не указан.',{'ram_gb':[f'{ram} ГБ'],'storage_gb':[f'{ssd} ГБ'],'color':[],'cpu':[]},category='Ноутбуки')
        add(f'absent-{i}',f'Чехол для смартфона с экраном 6,{i} дюйма. В комплекте один чехол. Оперативная память и процессор самого чехла отсутствуют; параметры совместимого телефона не являются его характеристиками.',{'ram_gb':[],'storage_gb':[],'cpu':[],'battery_mah':[],'screen_inches':[]},category='Чехлы')
    for i,processor in enumerate(['Intel Core i5-1235U','AMD Ryzen 5 5500U','Unisoc T610','MediaTek Helio G100 Ultimate','Qualcomm Snapdragon 8 Gen 2','Apple M3 Pro']):
        add(f'processor-{i}',f'Модель процессора: {processor}. Число ядер 8. ОЗУ 16 ГБ; накопитель 512 ГБ. {processor} отвечает за вычисления.',{'cpu':[processor],'ram_gb':['16 ГБ'],'storage_gb':['512 ГБ']},category='Компьютеры')
    for i,(brand,model,color) in enumerate([('DigiCare','Dr.Self Kit R3','жёлтый'),('Kitfort','КТ-316','чёрный'),('Tesler','TT-140','серый'),('Rekam','RT-D5G Digipod','белый'),('BQ','T1010','красный'),('Pantum','M6507','белый')]):
        add(f'boundaries-{i}',f'Товар {brand} {model}, {color}. Бренд: {brand}. Модель: {model}. Цвет корпуса: {color}.',{'brand':[brand],'model':[model],'color':[color]})
    add('multicolor-0','Штатив Rekam RT-D5G Digipod. Корпус серебристый и белый. Серебристый цвет сочетается с белыми вставками.',{'brand':['Rekam'],'model':['RT-D5G Digipod'],'color':['серебристый','белый','Серебристый','белыми']},category='Фото и видео')
    add('negation-0','Цвет корпуса: синий. Не красный и не чёрный. Оперативная память не указана. Объём упаковки 8 л, масса 256 г.',{'color':['синий'],'ram_gb':[],'storage_gb':[],'battery_mah':[]})
    add('html-0','<p data-color="красный">Ноутбук <b>Lenovo</b> <b>IdeaPad Slim 3</b>.</p><p>ОЗУ <b>16 ГБ</b>. Накопитель <b>512 ГБ</b>. Цвет корпуса — серый.</p>',{'brand':['Lenovo'],'model':['IdeaPad Slim 3'],'ram_gb':['16 ГБ'],'storage_gb':['512 ГБ'],'color':['серый']},category='Ноутбуки')
    # Explicit conflicting mentions: extractor preserves both, resolver must
    # flag conflict rather than silently choose a winner.
    add('conflict-0','Смартфон. В описании: оперативная память 4 ГБ. В данных продавца: оперативная память 5 ГБ. Требуется проверка источников.',{'ram_gb':['4 ГБ','5 ГБ'],'cpu':[],'color':[]})
    add('late-0','Описание товара. '+('Доставка и упаковка не задают технические характеристики. '*90)+'Оперативная память 12 ГБ. Накопитель 256 ГБ.',{'ram_gb':['12 ГБ'],'storage_gb':['256 ГБ']})
    # A separate challenge: different entities, wording and layout. Do not use
    # these rows to tune hyperparameters or thresholds.
    add('challenge-spec','Устройство Orion Nova X7, зелёный. Производитель Orion; обозначение модели Nova X7. Память для приложений (RAM): 6 ГБ. Для файлов: накопитель 128 ГБ.',{'brand':['Orion'],'model':['Nova X7'],'color':['зелёный'],'ram_gb':['6 ГБ'],'storage_gb':['128 ГБ'],'cpu':[]},'challenge')
    add('challenge-processor','Компьютер на Intel Core i7-13620H, DDR5, 24 ГБ оперативной памяти. Диск SSD 1 ТБ. Частота памяти 4800 МГц.',{'cpu':['Intel Core i7-13620H'],'ram_gb':['24 ГБ'],'storage_gb':['1 ТБ'],'color':[]},'challenge','Компьютеры')
    add('challenge-accessory','Сумка подходит для ноутбука с экраном 15,6 дюйма, памятью 16 ГБ и диском 512 ГБ. Собственные процессор, память и экран сумки не заявлены.',{'cpu':[],'ram_gb':[],'storage_gb':[],'screen_inches':[]},'challenge','Сумки')
    add('challenge-color','Корпус двухцветный: чёрный с серебристыми вставками. Красный вариант не предлагается. Память не указана.',{'color':['чёрный','серебристыми'],'ram_gb':[],'storage_gb':[]},'challenge')
    add('challenge-missing','Товар: настольная подставка. Артикул 8256. Габариты упаковки 8 × 16 × 32 см. Электронных компонентов нет.',{'cpu':[],'ram_gb':[],'storage_gb':[],'brand':[],'model':[],'battery_mah':[]},'challenge','Подставки')
    return rows


def build(source, output):
    source,output=Path(source),Path(output);output.mkdir(parents=True,exist_ok=True)
    if (output/'manifest.json').exists():raise FileExistsError('Use a new refinement output directory')
    registry=json.loads((source/'attribute_registry.json').read_text())
    audit=[];stats={};ids={};curriculum=synthetic_records()
    for split in ['train','dev']:
        rows=list(read_rows(source/f'{split}.jsonl.gz'))
        brands={(r['product_id'],r['field']):r['spans'] for r in rows if r['attribute_id']=='brand'}
        result=[];counts=collections.Counter()
        for r in rows:
            updated,reasons=repair_record(r,brands.get((r['product_id'],r['field']),()))
            counts['input_records']+=1
            if reasons:
                counts.update(reasons);counts['changed_records']+=1
                audit.append({'split':split,'product_id':r['product_id'],'field':r['field'],'attribute_id':r['attribute_id'],
                              'text':r['text'],'old_spans':r['spans'],'new_spans':updated['spans'] if updated else [],
                              'action':'repair' if updated else 'quarantine','reasons':reasons,
                              'verification':'deterministic_schema_policy_not_human'})
            if updated:result.append(updated)
            else:counts['quarantined_records']+=1
        counts['output_records']=len(result);stats[split]=dict(counts);ids[split]={r['group_id'] for r in result}
        write_rows(output/f'{split}.jsonl.gz',result)
    assert not ids['train']&ids['dev']
    write_rows(output/'hard_train.jsonl', [r for r in curriculum if r['split']=='train'])
    write_rows(output/'challenge.jsonl',[r for r in curriculum if r['split']=='challenge'])
    write_rows(output/'label_changes.jsonl',audit)
    # Preserve IDs while clarifying the RAM query's source aliases.
    registry['attributes']['ram_gb']['catalog_names']=[x for x in registry['attributes']['ram_gb']['catalog_names'] if x not in ['тип оперативной памяти','максимальная оперативная память','оперативная и встроенная память']]
    registry['refinement']='schema_policy_v2; original IDs preserved; counts recomputed for train/dev'
    for split in ['train','dev']:
        counts=collections.Counter(r['attribute_id'] for r in read_rows(output/f'{split}.jsonl.gz'))
        for a,d in registry['attributes'].items():d['positive_examples'][split]=counts[a]
    (output/'attribute_registry.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2))
    files=['train.jsonl.gz','dev.jsonl.gz','hard_train.jsonl','challenge.jsonl','label_changes.jsonl','attribute_registry.json']
    manifest={'version':'refinement_v2','source_sha256':{s:digest(source/f'{s}.jsonl.gz') for s in ['train','dev']},
              'statistics':stats,'files_sha256':{f:digest(output/f) for f in files},'test_opened':False,
              'train_dev_group_overlap':0,'hard_train_records':sum(r['split']=='train' for r in curriculum),
              'challenge_records':sum(r['split']=='challenge' for r in curriculum),
              'human_verified':False,'note':'Repaired silver by schema policy and agent-authored synthetic curriculum; no model outputs used to set labels. Dev corrections are not independent gold. Challenge is synthetic and small.'}
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    print(json.dumps(manifest,ensure_ascii=False,indent=2))


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',default='data/participant3_demo');p.add_argument('--output',default='data/participant3_refined');a=p.parse_args();build(a.source,a.output)

if __name__=='__main__':main()
