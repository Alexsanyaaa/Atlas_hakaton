import fs from 'node:fs/promises';
import {Presentation} from '@oai/artifact-tool';
const p=Presentation.create({slideSize:{width:1280,height:720}});
const s=p.slides.add();s.background.fill='#F4F2E9';
const b=await fs.readFile('../assets/catalog.png');
s.images.add({blob:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),contentType:'image/png',alt:'catalog',fit:'contain',position:{left:50,top:50,width:1150,height:600}});
const blob=await p.export({slide:s,format:'png',scale:1});
await fs.writeFile('test_image.png',new Uint8Array(await blob.arrayBuffer()));
console.log('done');
