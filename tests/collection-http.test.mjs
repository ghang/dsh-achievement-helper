import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
const root = process.env.JOURNAL_ARTIFACT ? new URL(`file://${process.env.JOURNAL_ARTIFACT}/lib/index.mjs`) : new URL('../src/index.mjs', import.meta.url);
const { createAchievementJournal } = await import(root);

test('authenticated collection flow preserves points across duplicate draws, validates custom art and equips owned cards', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'achievement-collection-http-')); let handler;
  const ctx = { sessions: {}, logger: { warn() {} }, on: () => () => {},
    webServer: { register(route) { handler=route.handler;return()=>{}; } },
    connection: { browserPeer: { id:'browser' }, admit(req) {return req.headers['x-fixture-peer']==='browser'?{peer:{id:'browser'}}:{rejection:401};} },
  };
  const service=await createAchievementJournal(ctx,{statePath:join(dir,'state.json'),collect:false,registerTools:false});
  const server=createServer((req,res)=>void handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await service.dispose();await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/dsh-achievement-journal/api`;
  const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-fixture-peer':'browser',...headers},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/draw',{method:'POST'})).status,401);
  assert.equal((await post('/preferences',{theme:'xianxia'})).status,200);
  assert.equal((await post('/draw',{requestId:'cross-site',theme:'xianxia'},{origin:'https://other.invalid'})).status,403);
  assert.equal((await post('/draw',{requestId:'no-points',theme:'xianxia'})).status,409);
  await service.mutate('configure',{requestId:'http-earned',definitions:[{title:'合成记录',rule:{template:'model_report'}}]});
  const definition=service.snapshot().definitions.find(d=>d.title==='合成记录');
  await service.mutate('report',{requestId:'http-award',definitionId:definition.id});
  assert.equal(service.snapshot().collection.points.balance,1);
  const beforeMismatch=service.snapshot();
  const mismatch=await post('/draw',{requestId:'wrong-global-theme',theme:'cyber'});
  assert.equal(mismatch.status,409);assert.equal((await mismatch.json()).code,'THEME_MISMATCH');
  assert.deepEqual(service.snapshot(),beforeMismatch,'Theme mismatch cannot spend points or mutate state');
  const drawBody={requestId:'one-ten-pull',theme:'xianxia'};
  const first=await post('/draw',drawBody);assert.equal(first.status,200);
  const drawn=await first.json();assert.equal(drawn.draw.results.length,10);assert.equal(drawn.collection.points.balance,0);
  assert.ok(drawn.draw.results.some(c=>['SR','SSR'].includes(c.rarity)));
  const retry=await (await post('/draw',drawBody)).json();assert.deepEqual(retry.draw,drawn.draw);assert.equal(retry.collection.points.spent,1);
  assert.equal((await post('/draw',{requestId:'second-ten-pull',theme:'xianxia'})).status,409);
  const owned=drawn.draw.results[0].id;
  const equip=await (await post('/equip',{id:owned,slot:'character',equipped:true})).json();assert.equal(equip.equipment.character,owned);
  const preferences=await(await post('/preferences',{frameStyle:'showcase',frameHeight:104,theme:'space'})).json();
  assert.equal(preferences.preferences.frameHeight,104);assert.equal(preferences.equipment.character,owned);
  const oldDraw=await post('/draw',drawBody);assert.equal(oldDraw.status,200);
  assert.deepEqual((await oldDraw.json()).draw,drawn.draw,'An exact retry returns its durable receipt after switching themes');
  const reused=await post('/draw',{...drawBody,theme:'space'});assert.equal(reused.status,409);
  assert.equal((await reused.json()).code,'REQUEST_ID_REUSED');
  const card={name:'合成灵舟',description:'仅测试数据',theme:'xianxia',rarity:'SR',icon:'star',animation:'float'};
  const created=await post('/characters',{requestId:'http-character',characters:[card]});assert.equal(created.status,200);
  const configured=await created.json(),custom=configured.collection.characters.find(c=>c.name===card.name);
  assert.ok(custom);assert.equal(custom.source,'user');assert.equal(configured.collection.points.balance,0);
  assert.ok(!configured.collection.owned.some(c=>c.id===custom.id),'Creating a pool entry never grants ownership');
  assert.notEqual((await post('/equip',{id:custom.id,slot:'character',equipped:true})).status,200);
  const invalid=await post('/characters',{requestId:'bad-art',characters:[{...card,art:'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='}]});assert.equal(invalid.status,400);
  const final=service.snapshot();assert.equal(final.collection.points.spent,1);assert.equal(final.collection.points.balance,0);
  await post('/equip',{id:definition.id,slot:'badge'});await post('/equip',{id:definition.id,slot:'charm'});
  const beforeDelete=service.snapshot(),deletion={requestId:'delete-earned-custom',expectedRevision:beforeDelete.revision,ids:[definition.id]};
  assert.equal((await fetch(base+'/delete',{method:'POST'})).status,401);
  assert.equal((await post('/delete',deletion,{origin:'https://other.invalid'})).status,403);
  const deletedResponse=await post('/delete',deletion);assert.equal(deletedResponse.status,200);
  const deleted=await deletedResponse.json();
  assert.equal(deleted.definitions.find(d=>d.id===definition.id).status,'archived');
  for(const key of ['awards','timeline','collection'])assert.deepEqual(deleted[key],beforeDelete[key],key+' survives deletion');
  assert.deepEqual(deleted.equipment.badges,[]);assert.equal(deleted.equipment.charm,null);assert.equal(deleted.equipment.character,owned);
  assert.equal((await(await post('/delete',deletion)).json()).revision,deleted.revision);
  const builtin=deleted.definitions.find(d=>d.source==='builtin');
  assert.equal((await(await post('/delete',{requestId:'cannot-delete-builtin',ids:[builtin.id]})).json()).code,'BUILTIN_DEFINITION_IMMUTABLE');
  assert.equal((await(await post('/report',{requestId:'cannot-reaward-deleted',definitionId:definition.id})).json()).code,'ARCHIVED');
  assert.equal((await(await post('/equip',{id:definition.id,slot:'badge'})).json()).code,'ARCHIVED');
  assert.deepEqual(service.snapshot().collection.points,{earned:1,spent:1,balance:0});
  // Oversize uploads deliberately terminate request-body streaming; keep this
  // last so the test does not reuse a socket being closed by the body limit.
  assert.equal((await post('/characters',{requestId:'big-art',characters:[{...card,art:'data:image/gif;base64,'+'A'.repeat(4*1024*1024)}]})).status,413);
});
