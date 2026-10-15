"""Export the same slide layout to a searchable PDF without a browser dependency."""
import json
from pathlib import Path
from html import escape

from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.utils import ImageReader, simpleSplit

ROOT=Path('/home/alex/desktop/haha')
BUILD=ROOT/'tmp/brief_atlas/build'
ASSETS=ROOT/'tmp/brief_atlas/assets'
OUT=ROOT/'output/pdf/atlas-product-brief.pdf'
W,H=1280,720
for family,file in [('Deck','NotoSans-Regular.ttf'),('DeckBold','NotoSans-Bold.ttf'),('DeckSerif','NotoSerif-Regular.ttf')]:
    pdfmetrics.registerFont(TTFont(family,'/usr/share/fonts/truetype/noto/'+file))

manifest=json.loads((BUILD/'manifest.json').read_text())
c=canvas.Canvas(str(OUT),pagesize=(W*.75,H*.75),pageCompression=1)
c.setTitle('Атлас. Продуктовый бриф')
c.setAuthor('Команда проекта Атлас')
c.setSubject('Сравнение четырёх подходов к извлечению характеристик товаров по качеству и полной стоимости')
wrap_audit=[]
for page,s in enumerate(manifest,1):
    c.saveState();c.scale(.75,.75)
    c.setFillColor(HexColor(s['background']));c.rect(0,0,W,H,fill=1,stroke=0)
    for o in s['objects']:
        x,y,w,h=o['x'],o['y'],o['w'],o['h']
        if o['kind']=='text':
            font='DeckSerif' if o.get('serif') else ('DeckBold' if o.get('bold') else 'Deck')
            size=o['size'];leading=size*1.15
            lines=[]
            for line in o['text'].split('\n'):
                lines.extend(simpleSplit(line,font,size,w) or [''])
            c.setFillColor(HexColor(o['color']));c.setFont(font,size)
            baseline=H-y-size*.95
            for line in lines:
                if o.get('align')=='right':c.drawRightString(x+w,baseline,line)
                elif o.get('align')=='center':c.drawCentredString(x+w/2,baseline,line)
                else:c.drawString(x,baseline,line)
                baseline-=leading
            used=size*.95+max(0,len(lines)-1)*leading
            wrap_audit.append({'page':page,'text':o['text'][:55],'lines':len(lines),'used_height':round(used,1),'frame_height':h,'bottom':round(y+used,1)})
        elif o['kind']=='image':
            r=o['rect'];scale=w/r['w']
            c.saveState()
            clip=c.beginPath();clip.rect(x,H-y-h,w,h);c.clipPath(clip,stroke=0,fill=0)
            c.drawImage(ImageReader(str(ASSETS/o['file'])),x-r['x']*scale,H-y+r['y']*scale-o['ih']*scale,width=o['iw']*scale,height=o['ih']*scale,mask='auto')
            c.restoreState()
        elif o['kind']=='table':
            vals=[]
            for ri,row in enumerate(o['values']):
                cells=[]
                for ci,value in enumerate(row):
                    st=ParagraphStyle('cell',fontName='DeckBold' if ri==0 or ci==0 else 'Deck',fontSize=17 if ri==0 else o['size'],leading=(17 if ri==0 else o['size'])*1.15,textColor=HexColor('#FFFFFF' if ri==0 else '#202A25'))
                    cells.append(Paragraph(escape(value),st))
                vals.append(cells)
            t=Table(vals,colWidths=o['colWidths'],rowHeights=o['rowHeights'])
            t.setStyle(TableStyle([
                ('BACKGROUND',(0,0),(-1,0),HexColor('#173D35')),
                ('BACKGROUND',(0,1),(-1,-1),HexColor('#F4F2E9')),
                ('GRID',(0,0),(-1,-1),1,HexColor('#D5D9CF')),
                ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
                ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
            ]))
            t.wrapOn(c,w,h);t.drawOn(c,x,H-y-h)
    c.restoreState();c.showPage()
c.save()
(BUILD/'pdf_text_layout_audit.json').write_text(json.dumps(wrap_audit,ensure_ascii=False,indent=2))
print(f'PDF: {len(manifest)} pages, {OUT.stat().st_size} bytes')
for x in wrap_audit:
    if x['bottom']>682 and x['text']!='АТЛАС':print('Bottom margin check:',x)
