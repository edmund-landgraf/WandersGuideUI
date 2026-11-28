import { describe,it,expect } from 'vitest';
import type { Encounter } from '@schemas/content';
import { encounterRevision,encounterSaveBody,preferNewerEncounterRevisions,verifyEncounterSave } from './phase1-encounter-revision';
const row: Encounter = {id:7,created_at:'2026-11-24T00:00:00Z',user_id:'fixture-owner',name:'Old',icon:'combat',color:'blue',campaign_id:1,combatants:{list:[]},meta_data:{encounter_revision:3}};
describe('revision checked encounter saves',()=>{
  it('uses original revision and limits rename to name',()=>expect(encounterSaveBody(row,{name:'New'})).toEqual({encounter_id:7,encounter_revision:3,patch:{name:'New'}}));
  it('accepts legacy missing revision but rejects malformed revision',()=>{
    expect(encounterRevision({...row,meta_data:{}})).toBe(0);
    expect(()=>encounterRevision({...row,meta_data:{encounter_revision:-1}})).toThrow();
  });
  it('keeps a cached encounter when a poll is an older revision',()=>{
    const saved = {...row,combatants:{list:[{_id:'pc',type:'CHARACTER' as const,character:67}]},meta_data:{encounter_revision:4}};
    const stale = {...row,meta_data:{encounter_revision:3}};
    expect(preferNewerEncounterRevisions([saved],[stale])).toEqual([saved]);
    expect(preferNewerEncounterRevisions([row],[saved])[0].meta_data.encounter_revision).toBe(4);
  });
  it('does not accept a stale or incomplete save receipt',()=>{
    expect(()=>verifyEncounterSave(row,row)).toThrow();
    expect(()=>verifyEncounterSave(row,null)).toThrow();
    expect(verifyEncounterSave(row,{...row,meta_data:{encounter_revision:4}}).meta_data.encounter_revision).toBe(4);
  });
});
