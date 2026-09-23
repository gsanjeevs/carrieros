// Heuristic scanner for hardcoded user-visible English. Reports per-area counts + samples.
import fs from 'node:fs'; import path from 'node:path'
const root=process.cwd()
function walk(d,o=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['node_modules','.next','generated'].includes(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p,o);else if(/\.(tsx|ts)$/.test(e.name)&&!/\.test\./.test(e.name)&&!/database\.ts|supabase\.ts|api-types/.test(e.name))o.push(p)}return o}
const words=s=>/[A-Za-z]{2,}/.test(s)&&/[A-Za-z]+\s+[A-Za-z]+|^[A-Z][a-z]{3,}/.test(s.trim())
const ATTR=/\b(placeholder|title|aria-label|alt|label|description|subtitle|helperText|emptyText|message|heading|text)=(?:"([^"{}]{3,})"|\{['"`]([^'"`${}]{3,})['"`]\})/g
const results={}
function area(f){ if(f.includes('carrieros-web/app/api')||f.includes('carrieros-web/server'))return 'web-api/server'; if(f.includes('carrieros-web/app'))return 'web-pages'; if(f.includes('carrieros-web/components'))return 'web-components'; if(f.includes('carrieros-web/lib'))return 'web-lib'; if(f.includes('carrieros-mobile/src/app'))return 'mobile-screens'; if(f.includes('carrieros-mobile/src/components'))return 'mobile-components'; return 'mobile-lib'}
const files=['carrieros-web/app','carrieros-web/components','carrieros-web/server','carrieros-web/lib','carrieros-mobile/src/app','carrieros-mobile/src/components','carrieros-mobile/src/lib'].flatMap(d=>walk(path.join(root,d)))
const hits=[]
for(const f of files){
  const src=fs.readFileSync(f,'utf8'); const rel=path.relative(root,f); const lines=src.split('\n')
  const isTsx=f.endsWith('.tsx')
  lines.forEach((ln,i)=>{
    const t=ln.trim(); if(t.startsWith('//')||t.startsWith('*')||t.startsWith('/*'))return
    let m
    if(isTsx){
      // JSX text node: >Some words<  or line that is only text between tags
      const re=/>([^<>{}=]*[A-Za-z]{2,}[^<>{}]*)</g
      while((m=re.exec(ln))){const s=m[1].trim(); if(words(s)&&!/^[A-Za-z]+$/.test(s)&&!/=>|&&|\|\||\?|;|\breturn\b/.test(s))hits.push([rel,i+1,'jsx-text',s])}
      // bare text line inside JSX
      if(/^[A-Z][A-Za-z,'.\- ]{6,}[.!:?]?$/.test(t)&&!/^(import|export|return|const|type|case|default)\b/.test(t)&&!/[;=(){}]/.test(t)&&/\s/.test(t)&&i>0&&/[>]\s*$|^\s*[A-Za-z]/.test(lines[i-1]||''))hits.push([rel,i+1,'jsx-bare',t])
      ATTR.lastIndex=0
      while((m=ATTR.exec(ln))){const s=m[2]||m[3]; if(words(s)&&!/^[a-z0-9_\-\/.:]+$/.test(s)&&!/^(bg-|text-|flex|grid|border|rounded|px-|py-|p-|m-|w-|h-)/.test(s))hits.push([rel,i+1,'attr:'+m[1],s])}
    }
    // error/messages in api/server/lib: apiError('CODE','msg'), new Error('msg'), throw, message: '...'
    const em=/(apiError\([^,]+,\s*|new \w*Error\(\s*|message:\s*|error:\s*|Alert\.alert\(\s*)(['"`])([^'"`]{6,}?)\2/g
    while((m=em.exec(ln))){const s=m[3]; if(words(s))hits.push([rel,i+1,'msg-literal',s])}
  })
}
const by={}
for(const h of hits){const a=area(h[0]);(by[a]??={})[h[2].split(':')[0]]=((by[a]??={})[h[2].split(':')[0]]||0)+1}
console.log(JSON.stringify(by,null,1)); console.log('total',hits.length)
fs.writeFileSync(process.argv[2]||'/dev/null',hits.map(h=>h.join('\t')).join('\n'))
