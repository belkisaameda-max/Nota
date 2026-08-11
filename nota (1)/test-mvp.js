const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
assert.match(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'), /Nota/);
assert.match(fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8'), /Nota/);
const port = 3107, file = path.join(__dirname, 'work', 'mvp-test.db');
for (const suffix of ['', '-wal', '-shm']) try { fs.rmSync(file + suffix); } catch {}
const child = spawn(process.execPath, ['server.js'], { cwd:__dirname, env:{...process.env,PORT:String(port),DB_FILE:file,SEED_DEMOS:'false',JWT_SECRET:'test-secret'}, stdio:'ignore' });
const base = `http://localhost:${port}`;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function req(url, options={}) { const r=await fetch(base+url,options); return {r,body:await r.json()}; }
async function run() {
 for(let i=0;i<40;i++){try{await fetch(base);break}catch{await sleep(100);if(i===39)throw Error('Server did not start')}}
 const register = user => req('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(user)});
 const amer=(await register({name:'Amer Test',username:'amer',email:'amer@test.local',password:'Password1!'})).body;
 const alex=(await register({name:'Alex Test',username:'alex',email:'alex@test.local',password:'Password1!'})).body;
 assert.ok(amer.token); assert.ok(alex.token); const ah={Authorization:`Bearer ${amer.token}`}, bh={Authorization:`Bearer ${alex.token}`};
 assert.equal((await req('/api/me',{headers:ah})).body.balanceCents,100000); assert.equal((await req('/api/me',{headers:bh})).body.balanceCents,100000);
 assert.equal((await req('/api/users/search?q=alex',{headers:ah})).body.users[0].username,'alex');
 const transfer=await req('/api/transfers',{method:'POST',headers:{...ah,'Content-Type':'application/json','Idempotency-Key':'mvp-key'},body:JSON.stringify({recipient:'alex',amount:'100.00',note:'MVP',idempotencyKey:'mvp-key'})}); assert.equal(transfer.r.status,201);
 assert.equal((await req('/api/me',{headers:ah})).body.balanceCents,90000); assert.equal((await req('/api/me',{headers:bh})).body.balanceCents,110000);
 assert.equal((await req('/api/transfers',{method:'POST',headers:{...ah,'Content-Type':'application/json','Idempotency-Key':'mvp-key'},body:JSON.stringify({recipient:'alex',amount:'100.00',idempotencyKey:'mvp-key'})})).body.duplicate,true);
 assert.equal((await req('/api/transactions',{headers:ah})).body.transactions.length,1); assert.equal((await req('/api/transactions',{headers:bh})).body.transactions.length,1);
 const login=(await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:'amer',password:'Password1!'})})).body; assert.equal((await req('/api/me',{headers:{Authorization:`Bearer ${login.token}`}})).body.balanceCents,90000);
 for(const [recipient,amount] of [['alex','0'],['alex','-1'],['alex','999999'],['amer','1'],['nobody','1']]) assert.equal((await req('/api/transfers',{method:'POST',headers:{...ah,'Content-Type':'application/json','Idempotency-Key':Math.random().toString()},body:JSON.stringify({recipient,amount,idempotencyKey:Math.random().toString()})})).r.status,400);
 assert.equal((await req('/api/me')).r.status,401); console.log('MVP tests passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>child.kill());
