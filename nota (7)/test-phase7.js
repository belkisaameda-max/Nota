'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = `/tmp/nota-phase7-${process.pid}.db`; try { fs.unlinkSync(path); } catch {}
process.env.NODE_ENV='test'; process.env.DB_FILE=path; process.env.SEED_DEMOS='true'; process.env.JWT_SECRET='phase7-test-secret';
const { app } = require('./server');
function request(server, path, options={}) { return new Promise((resolve,reject)=>{ const port=server.address().port; const req=http.request({hostname:'127.0.0.1',port,path,method:options.method||'GET',headers:{'Content-Type':'application/json',...(options.headers||{})}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({response:res,body:data?JSON.parse(data):{}}));});req.on('error',reject);if(options.body)req.write(JSON.stringify(options.body));req.end();}); }
(async()=>{const server=app.listen(0);try{
 const login=await request(server,'/api/auth/login',{method:'POST',body:{login:'amer',password:'NotaDemo1!'}}); assert.equal(login.response.statusCode,200); const auth={Authorization:`Bearer ${login.body.token}`};
 const low=await request(server,'/api/risk/evaluate',{method:'POST',headers:{...auth,'Idempotency-Key':'risk-low'},body:{evaluationType:'account_login',scenario:'LOW_RISK'}}); assert.equal(low.response.statusCode,201); assert.equal(low.body.evaluation.decision,'allow');
 const dup=await request(server,'/api/risk/evaluate',{method:'POST',headers:{...auth,'Idempotency-Key':'risk-low'},body:{scenario:'BLOCKED'}}); assert.equal(dup.body.duplicate,true);
 const blocked=await request(server,'/api/risk/evaluate',{method:'POST',headers:{...auth,'Idempotency-Key':'risk-blocked'},body:{evaluationType:'transfer',scenario:'BLOCKED'}}); assert.equal(blocked.body.evaluation.decision,'deny');
 const cases=await request(server,'/api/admin/risk/cases',{headers:auth}); assert.equal(cases.response.statusCode,200); assert.ok(cases.body.cases.length>=1);
 const unauthorized=await request(server,'/api/admin/risk/cases',{headers:{Authorization:`Bearer ${login.body.token}`}}); assert.equal(unauthorized.response.statusCode,200);
 const status=await request(server,'/api/risk/status',{headers:auth}); assert.equal(status.response.statusCode,200);
 console.log('Phase 7 tests passed.');
}finally{server.close();try{fs.unlinkSync(path);}catch{}}})().catch(e=>{console.error(e);process.exitCode=1;});
