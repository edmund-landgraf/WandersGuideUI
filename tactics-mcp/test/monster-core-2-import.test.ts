import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesFoundryPublication } from "../../src/process/upload/foundry-publication.ts";
import { sheetEnv } from "../src/live-sheet.js";

const source = { name: "Monster Core 2", foundry_id: null, user_id: null };
const actor = {
  name: "Ember Fox", type: "npc",
  system: {
    details: { level: { value: 2 }, publication: { title: "Pathfinder Monster Core 2", remaster: true }, languages: { value: ["pyric"] }, publicNotes: "" },
    traits: { rarity: "common", size: { value: "sm" }, value: ["elemental", "fire"] },
    abilities: Object.fromEntries(Object.entries({str:1,dex:4,con:2,int:-2,wis:2,cha:1}).map(([key,mod]) => [key,{mod}])),
    attributes: { ac: {value:17}, hp:{max:35}, speed:{value:30,otherSpeeds:[]}, weaknesses:[{type:"cold",value:5}], immunities:[{type:"fire"}] },
    saves: {fortitude:{value:6},reflex:{value:10},will:{value:8}},
    perception:{mod:8,senses:[{type:"darkvision"}]},
    skills:{acrobatics:{base:8},athletics:{base:5},stealth:{base:8}},
  },
  items: [
    {name:"Jaws",type:"melee",system:{bonus:{value:10},traits:{value:["agile","finesse"]},damageRolls:{0:{damage:"1d4+3",damageType:"piercing"},1:{damage:"1d4",category:"persistent",damageType:"fire"}}}},
    {name:"Cloak in Embers",type:"action",system:{actionType:{value:"reaction"},description:{value:"<p><strong>Trigger</strong> An ally is targeted by fire.</p><p><strong>Effect</strong> Grant fire resistance 10.</p>"},traits:{value:[]}}},
  ],
};

test("official book title fallback admits only matching creature publications", () => {
  assert.equal(matchesFoundryPublication(source, actor, true), true);
  assert.equal(matchesFoundryPublication({...source,foundry_id:"Pathfinder Monster Core 2"},actor,true),true);
  assert.equal(matchesFoundryPublication({...source,user_id:"homebrew"},actor,true),false);
  assert.equal(matchesFoundryPublication(source,actor,false),false);
  assert.equal(matchesFoundryPublication({...source,name:"Monster Core"},actor,true),false);
  assert.equal(matchesFoundryPublication(source,{},true),false);
});

test("Monster Core 2 conversion retains printed Ember Fox damage, defenses, skills and reaction", async (t) => {
  process.env.SUPABASE_URL = 'https://fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
  process.env.SUPABASE_ANON_KEY = 'fixture';
  sheetEnv();
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
    dom.window.close();
  });
  const { convertFoundryCreatureToGranularCreature } = await import("../../src/process/upload/creature-import.ts");
  const result = convertFoundryCreatureToGranularCreature(actor);
  assert.equal(result.ac.value,17);
  assert.equal(result.hp.value,35);
  assert.deepEqual(result.perception.senses?.map(s=>s.name),["darkvision"]);
  assert.deepEqual(result.skills?.map(s=>[s.name,s.bonus]),[["acrobatics",8],["athletics",5],["stealth",8]]);
  assert.deepEqual(result.languages?.value,["pyric"]);
  assert.equal(result.attacks?.[0].attackBonus.attack1st,10);
  assert.equal(result.attacks?.[0].damage.damageBonus,3);
  assert.deepEqual(result.attacks?.[0].damage.extraEffects,["1d4 persistent fire"]);
  assert.equal(result.abilities?.[0].action,"REACTION");
  assert.match(result.abilities?.[0].trigger ?? "", /targeted by fire/);
});


test("pack loader includes Unicode filenames, excludes paths and rejects foreign publications", async (t) => {
  const { downloadMonsterCore2Files } = await import("../../src/process/upload/monster-core-2-pack.ts");
  const fetched: string[] = [];
  let foreign = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    fetched.push(String(input));
    if (String(input).includes("api.github.com")) return Response.json([
      {name:"hārakasura.json",type:"file"}, {name:"../unsafe.json",type:"file"}, {name:"folder",type:"dir"},
    ]);
    return Response.json(foreign ? {...actor,system:{details:{publication:{title:"Other book",remaster:true}}}} : actor);
  });
  const files = await downloadMonsterCore2Files();
  assert.deepEqual(files.map(f=>f.name),["hārakasura.json"]);
  assert.ok(fetched[1].includes(encodeURIComponent("hārakasura.json")));
  assert.equal(fetched.length,2);
  foreign = true;
  await assert.rejects(downloadMonsterCore2Files(), /Unexpected publication/);
});
