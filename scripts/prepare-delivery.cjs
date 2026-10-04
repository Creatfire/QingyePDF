const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const output=path.resolve(process.argv[2]||path.join(root,'../output/qingye-pdf'));
const artifacts=[`QingyePDF-${version}-win-x64.exe`,`QingyePDF-${version}-source.zip`,`QingyePDF-${version}-dependency-source.zip`];
for(const name of artifacts)assert(fs.existsSync(path.join(root,'dist',name)),`Missing ${name}`);
for(const file of ['docs/USER-GUIDE.md','FEATURES.md']){
  const content=fs.readFileSync(path.join(root,file),'utf8');
  for(const match of content.matchAll(/QingyePDF-(\d+\.\d+\.\d+)-(?:win-x64\.exe|(?:dependency-)?source\.zip|Setup-x64\.exe)/g))assert.equal(match[1],version,`${file} points to an old release`);
  assert(content.includes(`QingyePDF-${version}-win-x64.exe`),`${file} lacks current download`);
}
fs.mkdirSync(output,{recursive:true});
const copies=new Map(artifacts.map(name=>[name,path.join(root,'dist',name)]));
for(const name of ['README.md','FEATURES.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md','CONVERSION.md','HANDOFF.md','RELEASE-TARGET.json'])copies.set(name,path.join(root,name));
for(const name of ['使用说明.md',`使用说明-${version}.md`])copies.set(name,path.join(root,'docs','USER-GUIDE.md'));
copies.set(`功能对照-${version}.md`,path.join(root,'FEATURES.md'));
copies.set(`更新说明-${version}.md`,path.join(root,'CHANGELOG.md'));
copies.set(`LICENSE-${version}.txt`,path.join(root,'LICENSE'));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const records=[];
for(const [name,source]of copies){const target=path.join(output,name);fs.copyFileSync(source,target);assert.equal(digest(target),digest(source),`Copy mismatch: ${name}`);records.push({name,bytes:fs.statSync(target).size,sha256:digest(target)});}
fs.writeFileSync(path.join(output,`SHA256-${version}.json`),JSON.stringify(records,null,2));
const manifest=path.join(output,'SHA256.json');
const previous=fs.existsSync(manifest)?JSON.parse(fs.readFileSync(manifest,'utf8').replace(/^\uFEFF/,'')):[];
fs.writeFileSync(manifest,JSON.stringify([...previous.filter(item=>!copies.has(item.name)),...records],null,2));
console.log(JSON.stringify({version,output,files:records.length,documentsVerified:true}));
