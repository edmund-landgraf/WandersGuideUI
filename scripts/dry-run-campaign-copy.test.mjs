import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./.dist/dry-run-campaign-copy.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('../', import.meta.url));
const token = 'test-user-token-not-for-output';
const anon = 'test-public-key-not-for-output';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function run(args, env, npm = false) {
  return new Promise((resolve, reject) => {
    const command = npm ? (process.platform === 'win32' ? 'npm.cmd' : 'npm') : process.execPath;
    const child = spawn(command, npm ? ['run','dry-run:campaign-copy','--',...args] : [cli,...args],
      { cwd, env, shell: npm && process.platform === 'win32', stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
function environment(base, extra = {}) {
  const env = { ...process.env };
  for (const name of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','VITE_SUPABASE_URL','VITE_SUPABASE_KEY',
    'CAMPAIGN_COPY_TOKEN','CAMPAIGN_COPY_USER_ID','VITE_PUBLIC_ASSET_ORIGIN','VITE_PUBLIC_STORAGE_ORIGIN']) delete env[name];
  return { ...env, SUPABASE_URL: base, SUPABASE_ANON_KEY: anon, CAMPAIGN_COPY_TOKEN: token, ...extra };
}
function noSecrets(result) {
  assert(!result.stdout.includes(token) && !result.stderr.includes(token));
  assert(!result.stdout.includes(anon) && !result.stderr.includes(anon));
}

test('dry-run CLI: actual process, authenticated identity, no writes or credential logs', async t => {
  const requests = [];
  let authStatus = 200, encounterStatus = 200, wrongCampaign = false, empty = false, incomplete = false, disconnect = false;
  const server = createServer(async (req,res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    const body = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : undefined;
    requests.push({ path:req.url, method:req.method, body, auth:req.headers.authorization, apikey:req.headers.apikey });
    res.setHeader('content-type','application/json');
    if (req.url === '/auth/v1/user') {
      res.statusCode = authStatus;
      res.end(JSON.stringify(authStatus === 200 ? { id:userId } : { message:token }));
    } else if (req.url === '/functions/v1/wgui-ext-find-encounter') {
      if (disconnect) { req.socket.destroy(); return; }
      res.statusCode = encounterStatus;
      res.end(JSON.stringify(encounterStatus === 200 ? { status:'success',data:{
        campaignId:41, encounterCount:incomplete?2:empty?0:1,
        encounters:empty?[]:[{ id:1,campaign_id:wrongCampaign?99:41,name:'Fixture encounter' }]
      } } : { message:token }));
    } else if (req.url === '/functions/v1/find-campaign') {
      res.end(JSON.stringify({ status:'success',data:[{ id:41,name:'Fixture campaign',notes:{pages:[{}]},meta_data:{image_url:'/backgrounds/banner.webp',encounter_folders:[{}]} }] }));
    } else { res.statusCode = 500; res.end('{}'); }
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    await t.test('help works without configuration', async () => {
      const result = await run(['--help'],environment(base,{ CAMPAIGN_COPY_TOKEN:'', SUPABASE_ANON_KEY:'' }));
      assert.equal(result.code,0); assert.match(result.stdout,/CAMPAIGN_COPY_USER_ID/);
      assert.equal(requests.length,0);
    });
    await t.test('rejects invalid IDs and missing token/key before network access', async () => {
      for (const args of [[],['0'],['-1'],['1.5'],['1e3'],['Infinity'],['9007199254740992'],['41','42']]) {
        const result = await run(args,environment(base));
        assert.equal(result.code,2); assert.match(result.stderr,/positive safe integer/); noSecrets(result);
      }
      for (const extra of [{CAMPAIGN_COPY_TOKEN:''},{SUPABASE_ANON_KEY:''},{SUPABASE_ANON_KEY:'sb_secret_fixture'}]) {
        const result = await run(['41'],environment(base,extra));
        assert.equal(result.code,2); noSecrets(result);
      }
      assert.equal(requests.length,0);
    });
    await t.test('rejects invalid token and mismatched optional identity before campaign access', async () => {
      authStatus = 401;
      let result = await run(['41'],environment(base));
      assert.equal(result.code,1); assert.match(result.stderr,/Authentication.*401/); noSecrets(result);
      authStatus = 200;
      result = await run(['41'],environment(base,{CAMPAIGN_COPY_USER_ID:'different-user'}));
      assert.equal(result.code,2); assert.match(result.stderr,/does not match/); noSecrets(result);
      assert.deepEqual(requests.splice(0).map(r=>r.path),['/auth/v1/user','/auth/v1/user']);
    });
    await t.test('documented npm invocation succeeds with only a verified token, URL and anon key', async () => {
      const result = await run(['41'],environment(base),true);
      assert.equal(result.code,0,result.stderr);
      const plan = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
      assert.equal(plan.sourceCampaignId,41); assert.equal(plan.encounterCount,1);
      assert.equal(plan.notePageCount,1); assert.equal(plan.folderCount,1); assert.equal(plan.artAction,'rehost');
      noSecrets(result);
      assert.deepEqual(requests.map(r=>[r.method,r.path,r.body]),[
        ['GET','/auth/v1/user',undefined],
        ['POST','/functions/v1/wgui-ext-find-encounter',{campaign_id:41,for_campaign_copy:true,copy_manifest:true}],
        ['POST','/functions/v1/find-campaign',{id:41}],
      ]);
      for (const req of requests) { assert.equal(req.auth,'Bearer '+token); assert.equal(req.apikey,anon); }
      requests.length=0;
    });
    await t.test('matching legacy ID works; forbidden or cross-campaign encounters fail closed', async () => {
      let result = await run(['41'],environment(base,{CAMPAIGN_COPY_USER_ID:userId.toUpperCase()}));
      assert.equal(result.code,0); noSecrets(result); requests.length=0;
      encounterStatus=403;
      result=await run(['41'],environment(base));
      assert.equal(result.code,1); assert.match(result.stderr,/403/); assert.equal(result.stdout,''); noSecrets(result);
      assert.deepEqual(requests.splice(0).map(r=>r.path),['/auth/v1/user','/functions/v1/wgui-ext-find-encounter']);
      encounterStatus=200; wrongCampaign=true;
      result=await run(['41'],environment(base));
      assert.equal(result.code,1); assert.match(result.stderr,/verify.*encounter list/); noSecrets(result);
      assert.deepEqual(requests.splice(0).map(r=>r.path),['/auth/v1/user','/functions/v1/wgui-ext-find-encounter']);
      wrongCampaign=false;
    });
    await t.test('confirmed empty is success, incomplete/server/network failures are not', async () => {
      empty=true;
      let result=await run(['41'],environment(base));
      assert.equal(result.code,0); assert.equal(JSON.parse(result.stdout).encounterCount,0);
      empty=false; requests.length=0; incomplete=true;
      result=await run(['41'],environment(base));
      assert.equal(result.code,1); assert.equal(result.stdout,''); assert.match(result.stderr,/verify.*encounter list/);
      incomplete=false; requests.length=0; encounterStatus=500;
      result=await run(['41'],environment(base));
      assert.equal(result.code,1); assert.equal(result.stdout,''); assert.match(result.stderr,/500/); noSecrets(result);
      encounterStatus=200; requests.length=0; disconnect=true;
      result=await run(['41'],environment(base));
      assert.equal(result.code,1); assert.equal(result.stdout,''); assert.match(result.stderr,/connection failed/); noSecrets(result);
      assert(requests.every(r=>['/auth/v1/user','/functions/v1/wgui-ext-find-encounter'].includes(r.path)));
    });
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
});
