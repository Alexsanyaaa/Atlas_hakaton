import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const root='/home/alex/desktop/haha';
const build=path.join(root,'tmp/brief_atlas/build');
const assets=path.join(root,'tmp/brief_atlas/assets');
const out=path.join(root,'output/pdf');
const skill='/home/alex/.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations';
const python='/home/alex/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const C={paper:'#F4F2E9',ink:'#202A25',green:'#173D35',muted:'#586454',purple:'#5B17B8',line:'#D5D9CF',white:'#FFFFFF',light:'#E5EBD9'};
const W=1280,H=720;
const P=Presentation.create({slideSize:{width:W,height:H}});
const manifest=[];
const imageCache=new Map();
const dimensions=JSON.parse(await fs.readFile(path.join(assets,'dimensions.json'),'utf8'));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function text(s,str,x,y,w,h,size=24,opts={}){
 const shape=s.shapes.add({geometry:'textbox',name:opts.name||str.slice(0,42),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 shape.text=str;
 const st={fontSize:size,typeface:opts.serif?'Noto Serif':'Noto Sans',color:opts.color||C.ink,bold:!!opts.bold,alignment:opts.align||'left',verticalAlignment:'top',wrap:'square',autoFit:'none',insets:0,lineSpacing:1.15};
 shape.text.style=st;
 manifest.at(-1).objects.push({kind:'text',text:str,x,y,w,h,size,...opts,color:st.color});
 return shape;
}
function slide(q,title,opts={}){
 const s=P.slides.add();s.background.fill=opts.dark?C.green:C.paper;
 manifest.push({question:q,title,background:opts.dark?C.green:C.paper,objects:[]});
 text(s,q,64,31,1050,24,15,{color:opts.dark?C.light:C.muted,bold:true});
 text(s,String(manifest.length).padStart(2,'0')+' / 10',1110,31,106,24,15,{color:opts.dark?C.light:C.muted,align:'right'});
 if(title)text(s,title,64,83,1152,72,44,{bold:true,color:opts.dark?C.white:C.ink});
 text(s,'АТЛАС',64,684,280,20,13,{bold:true,color:opts.dark?C.light:C.muted});
 return s;
}
function note(s,str){s.speakerNotes.text=str;manifest.at(-1).notes=str;}
async function picture(s,file,rect,x,y,width,caption){
 const p=path.join(assets,file);
 let b=imageCache.get(p);if(!b){b=await fs.readFile(p);imageCache.set(p,b);}
 const iw=dimensions[file].width,ih=dimensions[file].height;
 const r=rect||{x:0,y:0,w:iw,h:ih};const height=width*r.h/r.w;
 s.images.add({blob:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),contentType:dimensions[file].format==='JPEG'?'image/jpeg':'image/png',alt:caption,fit:'cover',position:{left:x,top:y,width,height},crop:{left:r.x/iw,top:r.y/ih,right:(iw-r.x-r.w)/iw,bottom:(ih-r.y-r.h)/ih}});
 manifest.at(-1).objects.push({kind:'image',file,x,y,w:width,h:height,rect:r,iw,ih,alt:caption});
 return height;
}
function table(s,values,x,y,width,colWidths,rowHeights,size=20){
 const height=rowHeights.reduce((a,b)=>a+b,0);
 const t=s.tables.add({rows:values.length,columns:values[0].length,left:x,top:y,width,height,columnWidths:colWidths,values});
 t.styleOptions={headerRow:true,bandedRows:false};
 t.borders.assign({fill:C.line,width:1,style:'solid'});
 for(let r=0;r<values.length;r++){
  t.rows[r].height=rowHeights[r];
  for(let c=0;c<values[r].length;c++){
   const cell=t.getCell(r,c);cell.fill=r===0?C.green:C.paper;
   cell.text.style={fontSize:r===0?17:size,typeface:'Noto Sans',color:r===0?C.white:C.ink,bold:r===0||c===0,verticalAlignment:'middle',insets:10,wrap:'square',autoFit:'none'};
  }
 }
 manifest.at(-1).objects.push({kind:'table',values,x,y,w:width,h:height,colWidths,rowHeights,size});
 return t;
}

// 1. Business task and primary user. No separate title slide.
{
 const s=slide('Вопрос 1. Задача бизнеса и пользователь','',{dark:true});
 text(s,'Атлас',64,93,690,102,88,{serif:true,color:C.white});
 text(s,'Автоматическое заполнение\nхарактеристик товаров',64,220,700,120,42,{bold:true,color:C.white});
 text(s,'Из названия, описания и параметров продавца\nполучаем структурированные значения\nс подтверждением из исходного текста.',64,374,700,120,26,{color:C.light});
 text(s,'Основной пользователь',830,126,380,40,21,{bold:true,color:C.light});
 text(s,'Контент-менеджер\nтоварного каталога',830,180,390,90,30,{color:C.white});
 text(s,'Проверяет предложения системы\nи готовит карточки к выгрузке.',830,288,380,80,23,{color:C.light});
 text(s,'Задача бизнеса',830,416,380,40,21,{bold:true,color:C.light});
 text(s,'Сократить ручной перенос данных\nи исправление разнородных\nхарактеристик каталога М.Видео.',830,466,390,125,23,{color:C.white});
 text(s,'Сравниваем 4 подхода, чтобы выбрать\nэкономичный вариант при нужном качестве.',64,559,725,85,28,{bold:true,color:C.white});
 note(s,'Источник задачи: условия кейса М.Видео и переписка команды. Основной пользователь определён в приложенных версиях интерфейса: atlas.zip/atlas/README.md и atlas(1).zip/atlas/js/views/catalog.js. Экономия труда является ожидаемым эффектом, а не измеренным результатом.');
}
// 2. Requirements, uncertainty and actual readiness.
{
 const s=slide('Вопрос 2. Требования и ограничения','Требования к результату');
 text(s,'Разные входные данные',64,183,540,42,28,{bold:true});
 text(s,'Название, описание и параметры продавца.\nПартии CSV / JSON, описание в TXT\nили обычный вставленный текст.',64,239,540,115,24);
 text(s,'Схема зависит от категории',64,403,540,42,28,{bold:true});
 text(s,'Бренд, модель и ключевые характеристики.\nЕдиные названия, типы и единицы.\nРезультат включает оценку и источник.',64,457,540,120,24);
 text(s,'Проверяемое основание',676,183,540,42,28,{bold:true});
 text(s,'Каждое извлечённое значение связано\nс цитатой. Оценка модели помогает\nназначить проверку, но не гарантирует ответ.',676,239,540,125,24);
 text(s,'Неопределённость сохраняется',676,403,540,42,28,{bold:true});
 text(s,'Если данных нет, поле остаётся пустым.\nРасхождения требуют решения человека.\nОтклонение и отсутствие различаются.',676,457,540,120,24);
 text(s,'Сейчас: интерфейс реализован, модели оцениваем отдельно. Подключение к интерфейсу и общий прогон впереди. LLM в разработке.',64,618,1152,52,18,{color:C.muted});
 note(s,'Источники: материалы кейса в переписке, atlas.zip/atlas/README.md, код обеих версий. Фронтенды работают локально без подключения обученных моделей. Числа в операционных экранах иллюстрируют механику интерфейса. Предусмотренный формат результата не означает готовую серверную интеграцию.');
}
// 3. Scenario 1: input and draft.
{
 const s=slide('Вопрос 3. Основной сценарий решения','1. Приём данных');
 text(s,'Партия товаров',64,182,380,42,28,{bold:true});
 text(s,'Импорт CSV / JSON:\nпредпросмотр строк,\nсопоставление колонок\nи проверка ошибок.',64,237,390,150,25);
 text(s,'Один товар',64,435,380,42,28,{bold:true});
 text(s,'TXT или вставленный текст.\nСистема предлагает название,\nкатегорию и характеристики.\nПользователь проверяет черновик.',64,490,400,145,24);
 await picture(s,'draft.png',{x:20,y:325,w:1225,h:885},552,158,664,'Прототип: черновик карточки по текстовому описанию');
 text(s,'Черновик по описанию. Название, категория и значения доступны для правки.',552,650,664,35,14,{color:C.muted});
 note(s,'Изображение: atlas(1).zip, экран Добавить товары, пример Чайник. Локальный извлекатель формирует черновик Tefal KO6931 Sense. Другой путь ввода, импорт CSV/JSON и TXT, также присутствует в обеих версиях. Это прототип сценария интерфейса.');
}
// 4. Scenario 2: alternatives and explicit economic selection.
{
 const s=slide('Вопрос 3. Основной сценарий решения','2. Сравнение четырёх подходов');
 text(s,'Общий эксперимент: одни карточки, одна схема характеристик и единые правила оценки.',64,158,1152,54,24);
 table(s,[
  ['Подход','Что проверяем','Что входит в стоимость'],
  ['Правила и словари','Шаблоны записи и известные значения','CPU, разработка и поддержка правил'],
  ['NER на CRF','Извлечение по признакам слов и контексту','Разметка, обучение CRF и CPU'],
  ['Трансформер','Извлечение с учётом контекста атрибута','Разметка, дообучение и инференс'],
  ['LLM','Извлечение по инструкции и примерам','API-токены или локальные вычисления'],
 ],64,224,1152,[250,480,422],[42,62,62,62,62],20);
 text(s,'Выберем метод или гибрид с минимальной полной стоимостью\nсреди вариантов, которые проходят требования к качеству.',64,544,1152,75,27,{bold:true,color:C.green});
 text(s,'Отдельные оценки: трансформер silver span F1 около 0,917, правила с БЗ micro F1 около 0,925.\nПротоколы различаются, общего победителя пока нет. LLM в разработке.',64,633,1152,42,16,{color:C.muted});
 note(s,'Сравнение четырёх подходов запрошено пользователем, в том числе выбор лучшего/недорогого. Возможности сравнения представлены в atlas.zip/atlas/js/approaches.js и atlas(1).zip/atlas/js/views/approaches.js. Рабочие гипотезы не являются доказанным рейтингом. Числа: скриншот трансформера из переписки, шаг 6000, support 21314, F1 0.9174417799, P 0.9028756, R 0.9324857, разметка silver; /home/alex/Downloads/Текстовый документ(1).txt: правила+БЗ, dev 2389 карточек, micro F1 0.925, P 0.983, R 0.874. Новые версии сайта содержат другие оценки и наборы; они не объединяются с этими числами. LLM ещё не разработана.');
}
// 5. Scenario 3: catalog and exceptions.
{
 const s=slide('Вопрос 3. Основной сценарий решения','3. Каталог и очередь проверки');
 text(s,'Понятный следующий шаг',64,181,300,83,28,{bold:true});
 text(s,'Поиск по товару,\nбренду или SKU.\nФильтры по категории\nи состоянию карточки.',64,290,300,140,24);
 text(s,'Сначала конфликты\nи спорные значения.\nНовые товары можно\nобрабатывать массово.',64,468,300,150,24);
 const h=await picture(s,'catalog.png',{x:17,y:73,w:1225,h:625},386,185,830,'Прототип: каталог с очередью проблем и статусами');
 text(s,'Показатели на экране иллюстрируют механику интерфейса.',386,185+h+15,830,35,14,{color:C.muted});
 note(s,'Изображение: atlas(1).zip, каталог с 43 подготовленными карточками. Поиск, статусы, выделение и обработка новых карточек доступны в локальном интерфейсе. 76% и численность карточек на скриншоте не являются оценкой эффекта внедрения в М.Видео.');
}
// 6. Scenario 4: evidence and manual choice.
{
 const s=slide('Вопрос 3. Основной сценарий решения','4. Решение по цитате');
 text(s,'В описании',64,184,270,35,23,{color:C.muted});
 text(s,'4 ГБ RAM',64,229,550,75,52,{bold:true,color:C.green});
 text(s,'В параметрах продавца',64,334,550,35,23,{color:C.muted});
 text(s,'5 ГБ RAM',64,380,550,75,52,{bold:true,color:C.purple});
 text(s,'Система показывает расхождение\nи оба основания. Сотрудник сверяет\nисточники, затем принимает значение\nили вносит исправление.',64,483,590,125,24);
 text(s,'Отклонить кандидата и подтвердить отсутствие\nхарактеристики в тексте можно отдельно.',64,628,590,45,18,{color:C.muted});
 await picture(s,'review.png',{x:555,y:562,w:688,h:729},726,154,490,'Прототип: цитата, варианты и решение по оперативной памяти');
 note(s,'Изображение: atlas(1).zip, карточка TECNO Spark 20C, SKU 30074402, подготовленный сценарий расхождения RAM 4/5 ГБ. Фрагменты из описания и параметров продавца показаны в интерфейсе. Презентация не утверждает, какое из двух значений фактически верно. Требуется сверка с надёжным источником поставщика.');
}
// 7. Scenario 5: normalization and dictionaries, from the other supplied version.
{
 const s=slide('Вопрос 3. Основной сценарий решения','5. Нормализация значений');
 text(s,'Одна единица каталога',64,184,290,75,28,{bold:true});
 text(s,'«2,2 кВт»\n2200 Вт',64,287,300,106,37,{bold:true,color:C.green});
 text(s,'Словари объединяют\nварианты написания\nцветов, брендов\nи материалов.',64,430,290,140,24);
 text(s,'Правило можно проверить\nна тексте перед применением.',64,599,300,70,20,{color:C.muted});
 const h=await picture(s,'dictionary.png',{x:16,y:73,w:1216,h:625},381,181,835,'Прототип: правило единиц и проверка на примере');
 text(s,'Словарь единиц и проверка преобразования на примере.',381,181+h+16,835,40,14,{color:C.muted});
 note(s,'Изображение: atlas.zip, экран Словари нормализации, поиск кВт. Правило кВт/kW -> Вт с множителем 1000. В предпросмотре 2,2 кВт -> 2200 Вт, 1700 мл -> 1,7 л, ОЗУ -> Оперативная память. Правки словарей не должны незаметно менять принятые ранее значения.');
}
// 8. Scenario 6: export and operational feedback.
{
 const s=slide('Вопрос 3. Основной сценарий решения','6. Выгрузка и контроль');
 const h=await picture(s,'export.png',{x:348,y:99,w:555,h:513},64,177,490,'Прототип: выгрузка карточек и формат результата');
 text(s,'Готовые карточки',620,179,585,42,29,{bold:true});
 text(s,'CSV / JSON для дальнейшей загрузки\nв товарную систему. Для каждого значения\nсохраняется происхождение решения.',620,238,590,112,25);
 text(s,'Контроль процесса',620,397,585,42,29,{bold:true});
 text(s,'Аналитика показывает очередь, частые\nисправления и долю автоприёма.\nРучная правка перестаёт считаться\nавтоматическим решением.',620,456,590,146,25);
 text(s,'Результаты проверки помогают выбирать категории для следующего улучшения.',620,629,590,45,18,{color:C.muted});
 note(s,'Изображение: atlas(1).zip, модальное окно Выгрузка данных. Реализованы локальные CSV/JSON, статусы решений и аналитика. Здесь описана предполагаемая передача в товарную систему через файл, а не готовая серверная интеграция. Количество 18 готовых карточек на скриншоте относится только к подготовленному интерфейсному набору.');
}
// 9. Value as expected, measurable effects.
{
 const s=slide('Вопрос 4. Ценность для пользователя и бизнеса','Ценность решения');
 text(s,'Контент-менеджер',64,185,540,45,30,{bold:true,color:C.green});
 text(s,'Проверяет предложение и цитату\nвместо ручного переноса всех полей.',64,263,530,85,28);
 text(s,'Сразу видит, где есть конфликт\nи какое решение требуется.',64,393,530,85,28);
 text(s,'Использует единые словари\nи понятные статусы карточек.',64,523,530,85,28);
 text(s,'Бизнес',676,185,540,45,30,{bold:true,color:C.green});
 text(s,'Меньше времени на подготовку\nтоваров к публикации.',676,263,530,85,28);
 text(s,'Единообразные характеристики\nдля поиска и фильтров каталога.',676,393,530,85,28);
 text(s,'Выбор технологии по полной цене,\nвключая проверку человеком.',676,523,530,85,28);
 text(s,'Ожидаемый эффект проверим в пилоте: время работы, ошибки и стоимость одной готовой карточки.',64,638,1152,40,18,{color:C.muted});
 note(s,'Ценность сформулирована как ожидаемый эффект на основе задачи и механик интерфейса. Нет измеренного экономического эффекта, доказанного роста конверсии или производственного процента автоматизации. Для проверки нужен пилот с сопоставимой ручной группой и учётом стоимости труда.');
}
// 10. The one requested metrics slide, including the decision rule.
{
 const s=slide('Вопрос 5. Метрики успеха','Критерии выбора и успеха');
 text(s,'Единый эталон с ручной проверкой, отдельный test и одинаковые правила оценки.',64,157,1152,55,23);
 table(s,[
  ['Показатель','Как проверяем'],
  ['Качество','Micro F1 нормализованных пар и macro F1 по категориям'],
  ['Надёжность автоприёма','Precision автоматически принятых значений'],
  ['Автоматизация','Автоматически принятые поля / все применимые поля'],
  ['Скорость','P50 / P95 обработки и время ручной проверки карточки'],
  ['Полная стоимость','₽ за 1000 готовых карточек, включая вычисления и труд'],
 ],64,224,1152,[370,782],[40,57,57,57,57,57],21);
 text(s,'Предлагаемый порог: precision автоприёма не ниже 98%.\nОбучение и поддержку учитываем в стоимости на выбранном объёме каталога.',64,577,1152,58,19,{color:C.muted});
 text(s,'Выберем самый экономичный вариант, который проходит пороги качества и скорости.',64,649,1152,35,22,{bold:true,color:C.green});
 note(s,'Метрики и порог 98% являются предложенным протоколом пилота, не условиями организатора и не достигнутым результатом. Порог скорости и минимальный F1 согласуются перед общим экспериментом, после оценки ручного базового процесса и SLA каталога. Полная стоимость включает инференс/API, труд проверки и исправлений, амортизацию обучения и поддержку. Сравнение одних правил, CRF, трансформера, LLM и гибридов проводится на том же test. Уверенность моделей калибруется по dev, затем пороги фиксируются. Обучение и test разделяют по товарным группам, чтобы близкие варианты SKU не давали утечку.');
}

await fs.mkdir(build,{recursive:true});await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(build,'manifest.json'),JSON.stringify(manifest,null,2));
const draft=path.join(build,'brief-draft.pptx');
await (await PresentationFile.exportPptx(P)).save(draft);
console.log('Draft PPTX saved');
for(let i=0;!process.argv.includes('--fast')&&i<P.slides.items.length;i++){
 const blob=await P.export({slide:P.slides.items[i],format:'png',scale:1.5});
 await fs.writeFile(path.join(build,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));
 console.log('Rendered slide',i+1);
}
try{
 const pdf=await P.export({format:'pdf'});
 await fs.writeFile(path.join(out,'atlas-product-brief.pdf'),new Uint8Array(await pdf.arrayBuffer()));
 console.log('PDF saved');
}catch(e){
 console.log('Native PDF export unavailable:',e.message.split('\n')[0]);
 console.log('Use ReportLab PDF generation from the shared layout manifest.');
}

const fonts=[];
for(const [family,file,weight]of [['Deck Sans','NotoSans-Regular.ttf',400],['Deck Sans','NotoSans-Bold.ttf',700],['Deck Serif','NotoSerif-Regular.ttf',400]]){
 const bytes=await fs.readFile('/usr/share/fonts/truetype/noto/'+file);
 fonts.push(`@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype');font-display:swap}`);
}
function htmlObject(o){
 let base=`left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px;`;
 if(o.kind==='text')return `<div class="obj text" style="${base}font-size:${o.size}px;font-family:'${o.serif?'Deck Serif':'Deck Sans'}';font-weight:${o.bold?700:400};color:${o.color};text-align:${o.align||'left'}">${esc(o.text)}</div>`;
 if(o.kind==='image'){
  const bytes=imageCache.get(path.join(assets,o.file));const scale=o.w/o.rect.w;
  return `<div class="obj image" style="${base}"><img alt="${esc(o.alt)}" src="data:${dimensions[o.file].format==='JPEG'?'image/jpeg':'image/png'};base64,${bytes.toString('base64')}" style="position:absolute;width:${o.iw*scale}px;height:${o.ih*scale}px;left:${-o.rect.x*scale}px;top:${-o.rect.y*scale}px"></div>`;
 }
 const cols=o.colWidths.map(v=>`<col style="width:${v}px">`).join('');
 const rows=o.values.map((r,i)=>`<tr style="height:${o.rowHeights[i]}px">${r.map((c,j)=>`<${i===0?'th':'td'} style="font-size:${i===0?17:o.size}px;font-weight:${i===0||j===0?700:400}">${esc(c)}</${i===0?'th':'td'}>`).join('')}</tr>`).join('');
 return `<table class="obj data" style="${base}"><colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`;
}
const slides=manifest.map((s,i)=>`<section class="slide${i===0?' active':''}" role="group" aria-roledescription="слайд" aria-label="${i+1} из 10. ${esc(s.title||'Атлас. Задача бизнеса и пользователь')}" data-title="${esc(s.title||'Атлас')}" style="background:${s.background}">${s.objects.map(htmlObject).join('')}</section>`).join('\n');
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Атлас. Продуктовый бриф: сравнение четырёх способов извлечения характеристик товаров по качеству и полной стоимости."><title>Атлас — продуктовый бриф</title><style>${fonts.join('\n')}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#161c18;color:#fff;font-family:'Deck Sans',sans-serif}body{overflow:hidden}#stage{position:absolute;left:50%;top:calc(50% - 22px);width:1280px;height:720px;transform-origin:center center}.slide{display:none;width:1280px;height:720px;position:absolute;inset:0;color:${C.ink};overflow:hidden}.slide.active{display:block}.obj{position:absolute}.text{white-space:pre-wrap;line-height:1.15;overflow:visible}.image{overflow:hidden}.image img{max-width:none}.data{border-collapse:collapse;table-layout:fixed;font-family:'Deck Sans';line-height:1.15}.data th,.data td{border:1px solid ${C.line};padding:10px;vertical-align:middle;text-align:left;color:${C.ink};background:${C.paper}}.data th{background:${C.green};color:#fff}.controls{position:fixed;bottom:10px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:12px;height:38px;font-size:13px;color:#d8e2d3}button{border:1px solid #52614d;color:#e7ecde;background:#28342b;border-radius:5px;padding:8px 14px;cursor:pointer;font:inherit}button:hover{background:#3b4f3c}button:disabled{opacity:.35;cursor:default}button:focus-visible{outline:3px solid #d6e8b9;outline-offset:2px}#counter{min-width:70px;text-align:center}.hint{opacity:.65;margin-left:12px}@media(max-width:700px){.hint{display:none}.controls{font-size:12px;gap:8px}button{padding:8px 10px}}@media print{@page{size:13.3333in 7.5in;margin:0}html,body{height:auto;overflow:visible;background:white}#stage{position:static;transform:none!important;width:1280px;height:auto}.slide{display:block!important;position:relative;break-after:page;page-break-after:always}.slide:last-child{break-after:auto}.controls{display:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main id="stage" aria-label="Продуктовый бриф Атлас">${slides}</main><nav class="controls" aria-label="Переключение слайдов"><button id="prev" aria-label="Предыдущий слайд">Назад</button><span id="counter" aria-live="polite">1 / 10</span><button id="next" aria-label="Следующий слайд">Дальше</button><button id="fullscreen">На весь экран</button><span class="hint">Стрелки влево и вправо переключают слайды</span></nav><script>
(()=>{const slides=[...document.querySelectorAll('.slide')],stage=document.getElementById('stage'),prev=document.getElementById('prev'),next=document.getElementById('next'),counter=document.getElementById('counter');let n=Math.min(9,Math.max(0,(Number(location.hash.slice(1))||1)-1));function size(){const k=Math.min((innerWidth-24)/1280,(innerHeight-70)/720);stage.style.transform='translate(-50%,-50%) scale('+Math.max(.1,k)+')'}function show(i){n=Math.min(slides.length-1,Math.max(0,i));slides.forEach((s,k)=>{s.classList.toggle('active',k===n);s.setAttribute('aria-hidden',k===n?'false':'true')});counter.textContent=(n+1)+' / '+slides.length;prev.disabled=n===0;next.disabled=n===slides.length-1;history.replaceState(null,'','#'+(n+1));document.title=(n+1)+'. '+slides[n].dataset.title+' — Атлас'}prev.onclick=()=>show(n-1);next.onclick=()=>show(n+1);document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select'))return;if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();show(n+1)}if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(n-1)}if(e.key==='Home')show(0);if(e.key==='End')show(slides.length-1)});document.getElementById('fullscreen').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen()}catch(e){}};addEventListener('resize',size);addEventListener('hashchange',()=>show((Number(location.hash.slice(1))||1)-1));size();show(n)})();
</script></body></html>`;
await fs.writeFile(path.join(out,'atlas-product-brief.html'),html);
console.log('Standalone HTML saved');

const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
process.env.RUNTIME_NODE_MODULES='/home/alex/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
await fs.mkdir(path.join(build,'validated'),{recursive:true});
const final=await finalizePresentation({workspaceDir:root,candidatePath:draft,finalPath:path.join(build,'validated','brief.pptx'),pythonExecutable:python,integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit','--require-native-table-slide','4','--require-native-table-slide','10'],explicitTotalSlideCount:10,requiredNativeTableOwnerSlides:[4,10],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Noto Sans','Noto Serif']},verifyArtifactToolImport:true,receiptPath:path.join(build,'validation.json')});
console.log(JSON.stringify(final));
