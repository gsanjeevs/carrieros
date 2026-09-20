// Broader sweep: multi-word capitalised quoted literals in TSX not in i18n calls.
import fs from 'node:fs'; import path from 'node:path'
function walk(d,o=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['node_modules','.next','generated'].includes(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p,o);else if(/\.tsx$/.test(e.name))o.push(p)}return o}
const roots={'web':['carrieros-web/app','carrieros-web/components'],'mobile':['carrieros-mobile/src/app','carrieros-mobile/src/components']}
const out=[]
for(const [k,rs] of Object.entries(roots))for(const f of rs.flatMap(r=>walk(r))){
  fs.readFileSync(f,'utf8').split('\n').forEach((ln,i)=>{
    const t=ln.trim(); if(/^(\/\/|\*|\/\*|import |export \{|console\.|logError|throw )/.test(t))return
    if(/className|\bclass=|\bstyle=|href=|key=|testID|accessibilityRole|from '|require\(|t\(|tCommon\(|useTranslations|getTranslations/.test(ln)&&!/placeholder|title=|label=/.test(ln))return
    const re=/(['"`])([A-Z][a-z]+(?: [A-Za-z][a-z'’,.\-!?]*){1,}[.!?…]?)\1/g;let m
    while((m=re.exec(ln))){const s=m[2]; if(/^(Content|Cache|Bearer|Idempotency|Last|Access|Sign|Retry)/.test(s)&&/-/.test(s))continue; out.push([k,path.relative('.',f),i+1,s])}
  })}
const by={};out.forEach(o=>by[o[0]]=(by[o[0]]||0)+1);console.log(by,out.length)
fs.writeFileSync(process.argv[2],out.map(o=>o.join('\t')).join('\n'))
