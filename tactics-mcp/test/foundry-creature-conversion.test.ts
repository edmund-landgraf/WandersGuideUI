import assert from "node:assert/strict";
import { test } from "node:test";
import { sheetEnv } from "../src/live-sheet.js";

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
  const preparedActor = structuredClone(actor);
  const casting = {
    _id: "casting", name: "Arcane Spells", type: "spellcastingEntry",
    system: {tradition:{value:"arcane"},spelldc:{dc:18,value:10},prepared:{value:"prepared"},slots:{
      slot1:{max:4,prepared:{0:{id:"spell"},1:{id:null},2:null,3:{id:"missing"}}},
      slot2:{max:2,prepared:[{id:"spell"},{}]},
    }},
  };
  const spell = {_id:"spell",name:"Force Barrage",type:"spell",system:{slug:"force-barrage",level:{value:1},location:{value:"casting"}}};
  const prepared = convertFoundryCreatureToGranularCreature({...preparedActor,items:[...preparedActor.items,casting,spell]});
  assert.deepEqual(prepared.spellcasting?.prepared?.spells?.map(s=>[s.name,s.rank,s.amount]), [["Force Barrage",1,1],["Force Barrage",2,1]]);
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
