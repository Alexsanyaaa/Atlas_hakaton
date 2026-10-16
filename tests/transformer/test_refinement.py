import copy
import pytest
from catalog_ai.participant3.refinement import repair_record, synthetic_records
from catalog_ai.participant3.prepare import attribute_for_name
from catalog_ai.participant3.bio import encode_records
from catalog_ai.participant3.diagnostics import select_threshold


def row(text,attr,quotes,**extra):
    return {'text':text,'attribute_id':attr,'spans':[{'start':text.index(q),'end':text.index(q)+len(q),'quote':q} for q in quotes],**extra}


def test_ram_type_and_maximum_are_not_installed_capacity():
    assert attribute_for_name('Тип оперативной памяти') is None
    assert attribute_for_name('Максимальная оперативная память') is None
    assert attribute_for_name('Оперативная и встроенная память') is None
    assert attribute_for_name('Оперативная память (RAM)')=='ram_gb'
    r=row('ОЗУ LPDDR5, 16 ГБ','ram_gb',['LPDDR5','16 ГБ']);before=copy.deepcopy(r)
    fixed,reasons=repair_record(r)
    assert [s['quote'] for s in fixed['spans']]==['16 ГБ']
    assert r==before


def test_removed_silver_value_is_unknown_not_negative():
    fixed,reasons=repair_record(row('Тип ОЗУ DDR4','ram_gb',['DDR4']))
    assert fixed is None


def test_model_boundaries_and_processor_completion():
    r=row('DigiCare Dr.Self Kit R3 жёлтый','model',['DigiCare Dr.Self Kit R3 жёлтый'])
    fixed,_=repair_record(r,[{'start':0,'end':8}])
    assert fixed['spans'][0]['quote']=='Dr.Self Kit R3'
    fixed,_=repair_record(row('Процессор Intel Core i5-1235U, 10 ядер','cpu',['Core i5']))
    assert fixed['spans'][0]['quote']=='Intel Core i5-1235U'
    # Not every use of the word "black" or a CPU-looking substring is guessed.
    fixed,_=repair_record(row('Модель Black Edition','model',['Black Edition']))
    assert fixed['spans'][0]['quote']=='Black Edition'


class Encoded(dict):
    def sequence_ids(self,i):return [None,1,1,None]

class Tokenizer:
    model_input_names=['input_ids']


def test_only_explicit_complete_annotations_allow_negative_windows(monkeypatch):
    import catalog_ai.participant3.bio as bio
    e=Encoded(input_ids=[[1,2,3,4]],offset_mapping=[[(0,0),(0,2),(3,5),(0,0)]])
    monkeypatch.setattr(bio,'encode_pair',lambda *args:e)
    r=row('не та','color',[])
    assert encode_records([r],Tokenizer())==[]
    r['annotation_complete']=True
    f=encode_records([r],Tokenizer())
    assert f[0]['labels']==[-100,0,0,-100]


def test_crossing_span_is_ignored_instead_of_partial_positive(monkeypatch):
    import catalog_ai.participant3.bio as bio
    e=Encoded(input_ids=[[1,2,3,4]],offset_mapping=[[(0,0),(3,5),(6,8),(0,0)]])
    monkeypatch.setattr(bio,'encode_pair',lambda *args:e)
    r={'text':'abcdefghij','attribute_id':'model','spans':[{'start':0,'end':5},{'start':6,'end':8}]}
    f=encode_records([r],Tokenizer())[0]
    assert f['labels']==[-100,-100,1,-100]
    assert f['gold_spans']==[{'start':6,'end':8}]


def test_synthetic_offsets_and_disjoint_family_groups():
    rows=synthetic_records();train={r['group_id'] for r in rows if r['split']=='train'}
    challenge={r['group_id'] for r in rows if r['split']=='challenge'}
    assert train.isdisjoint(challenge)
    assert any(not r['spans'] for r in rows)
    assert all(r['annotation_complete'] and r['verification']!='human' for r in rows)
    for r in rows:
        spans=sorted(r['spans'],key=lambda s:s['start'])
        for s in spans:assert r['text'][s['start']:s['end']]==s['quote']
        assert all(a['end']<=b['start'] for a,b in zip(spans,spans[1:]))


def test_thresholds_handle_score_ties_and_insufficient_support():
    scored={'a':.9,'b':.9,'c':.5};gold={'a','b','d'}
    result=select_threshold(scored,gold)
    assert result['threshold']==.9 and result['selected']==2
    assert select_threshold(scored,gold,.98,200)['threshold'] is None
