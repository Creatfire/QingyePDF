// Verify the delivered report against real artifacts; never reuse an older release's results.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,output=path.resolve(process.argv[2]||path.join(root,'..'));
const result=JSON.parse(fs.readFileSync(path.join(output,'BUILD-RESULT.json'),'utf8'));
assert.equal(result.version,version);assert.equal(result.buildRevision,'dev1');
const exe=path.join(output,`QingyePDF-${version}-win-x64.exe`);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),result.artifactSha256);
assert.ok(fs.existsSync(path.join(output,`BUILD-REPORT-${version}.md`)));console.log(JSON.stringify({version,reportMatchesArtifacts:true}));
