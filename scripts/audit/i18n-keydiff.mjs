// Audit helper: diff message key sets across locales (web ICU + mobile i18n-js).
import fs from 'node:fs'
const flat=(o,p='',out={})=>{for(const[k,v]of Object.entries(o)){const key=p?p+'.'+k:k;if(v&&typeof v==='object')flat(v,key,out);else out[key]=v}return out}
const phs=(s,kind)=>{ if(typeof s!=='string')return[]; const re=kind==='web'?/\{\s*(\w+)\s*(?:,|\})/g:/%\{(\w+)\}/g; const r=new Set();let m;while((m=re.exec(s)))r.add(m[1]);return[...r].sort()}
const langs=['en','es','pa','ur']
for(const [name,dir,kind] of [['WEB','carrieros-web/messages','web'],['MOBILE','carrieros-mobile/src/messages','mob']]){
  const d={};for(const l of langs)d[l]=flat(JSON.parse(fs.readFileSync(`${dir}/${l}.json`,'utf8')))
  console.log(`\n=== ${name}: en keys=${Object.keys(d.en).length}`)
  for(const l of langs.slice(1)){
    const ek=Object.keys(d.en),lk=Object.keys(d[l])
    const missing=ek.filter(k=>!(k in d[l])),extra=lk.filter(k=>!(k in d.en))
    const same=ek.filter(k=>k in d[l]&&d[l][k]===d.en[k]&&/[A-Za-z]{3,}/.test(d.en[k]))
    const empty=lk.filter(k=>d[l][k]==='')
    const phm=ek.filter(k=>k in d[l]&&JSON.stringify(phs(d.en[k],kind))!==JSON.stringify(phs(d[l][k],kind)))
    const latin=lk.filter(k=>(l==='pa'||l==='ur')&&typeof d[l][k]==='string'&&/[A-Za-z]{4,}/.test(d[l][k].replace(/\{[^}]*\}|%\{[^}]*\}/g,'')))
    // ICU plural sanity (web)
    const icuBad=kind==='web'?ek.filter(k=>typeof d.en[k]==='string'&&/plural,/.test(d.en[k])&&k in d[l]&&!/plural,/.test(d[l][k])):[]
    const icuNoOther=kind==='web'?lk.filter(k=>/plural,/.test(d[l][k]||'')&&!/other\s*\{/.test(d[l][k])):[]
    console.log(`-- ${l}: keys=${lk.length} missing=${missing.length} extra=${extra.length} identicalToEn=${same.length} empty=${empty.length} placeholderMismatch=${phm.length} latinResidue=${latin.length} pluralLost=${icuBad.length} pluralNoOther=${icuNoOther.length}`)
    if(missing.length)console.log('   missing:',missing.slice(0,15).join(', '))
    if(extra.length)console.log('   extra:',extra.slice(0,15).join(', '))
    if(phm.length)phm.slice(0,10).forEach(k=>console.log('   PH',k,JSON.stringify(phs(d.en[k],kind)),JSON.stringify(phs(d[l][k],kind))))
    if(same.length)console.log('   sameAsEn sample:',same.slice(0,12).join(', '))
    if(icuBad.length)console.log('   pluralLost:',icuBad.slice(0,8).join(', '))
    if(latin.length)console.log('   latin sample:',latin.slice(0,8).map(k=>k+'='+d[l][k].slice(0,40)).join(' | '))
  }
  // mobile plural shape check
  if(kind==='mob'){const raw={};for(const l of langs)raw[l]=JSON.parse(fs.readFileSync(`${dir}/${l}.json`,'utf8'))
    const walk=(o,p,cb)=>{for(const[k,v]of Object.entries(o))if(v&&typeof v==='object'){if('other' in v||'one' in v)cb(p?p+'.'+k:k,v);else walk(v,p?p+'.'+k:k,cb)}}
    const pl={};for(const l of langs){pl[l]=new Set();walk(raw[l],'',k=>pl[l].add(k))}
    for(const l of langs.slice(1))console.log(`   mobile plural objs en=${pl.en.size} ${l}=${pl[l].size} enOnly=${[...pl.en].filter(k=>!pl[l].has(k)).length}`)}
}
