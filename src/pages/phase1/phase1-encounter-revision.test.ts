import { describe,it,expect } from 'vitest';
import type { Encounter } from '@schemas/content';
import { encounterRevision,encounterSaveBody,verifyEncounterSave } from './phase1-encounter-revision';
const row = {id:7,name:'Old',icon:'combat',color:'blue',campaign_id:1,combatants:{list:[]},meta_data:{encounter_revision:3}} as Encounter;
describe('revision checked encounter saves',()=>{
  it('uses original revision and limits rename to name',()=>expect(encounterSaveBody(row,{name:'New'})).toEqual({encounter_id:7,encounter_revision:3,patch:{name:'New'}}));
  it('accepts legacy missing revision but rejects malformed revision',()=>{
    expect(encounterRevision({...row,meta_data:{}})).toBe(0);
    expect(()=>encounterRevision({...row,meta_data:{encounter_revision:-1}})).toThrow();
  });
  it('does not accept a stale or incomplete save receipt',()=>{
    expect(()=>verifyEncounterSave(row,row)).toThrow();
    expect(()=>verifyEncounterSave(row,null)).toThrow();
    expect(verifyEncounterSave(row,{...row,meta_data:{encounter_revision:4}}).meta_data.encounter_revision).toBe(4);
  });
});
