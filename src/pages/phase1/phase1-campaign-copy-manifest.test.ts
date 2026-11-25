import { describe, expect, it } from 'vitest';
import { parseCopyEncounterManifest, parseCopyPreparation, validCopyReceipt } from './phase1-campaign-copy-manifest';

const rows = [{id:1,campaign_id:41,name:'Active'},{id:2,campaign_id:41,name:'Hidden'}];
describe('complete campaign copy manifest', () => {
  it('accepts a complete list and an explicitly confirmed empty list', () => {
    expect(parseCopyEncounterManifest({campaignId:41,encounterCount:2,encounters:rows},41)).toEqual(rows);
    expect(parseCopyEncounterManifest({campaignId:41,encounterCount:0,encounters:[]},41)).toEqual([]);
  });
  it.each([null,[],{campaignId:41,encounterCount:2,encounters:rows.slice(0,1)},
    {campaignId:41,encounterCount:2,encounters:[rows[0],rows[0]]},
    {campaignId:41,encounterCount:1,encounters:[{...rows[0],campaign_id:42}]}])('rejects incomplete/legacy/invalid responses %j', response => {
    expect(()=>parseCopyEncounterManifest(response,41)).toThrow(/complete/);
  });
  it('requires counted IDs before any staging and confirms the final receipt', () => {
    expect(parseCopyPreparation({campaignId:41,encounterCount:2,encounterIds:[1,2],assets:[]},41).encounterIds).toEqual([1,2]);
    expect(()=>parseCopyPreparation({campaignId:41,encounterCount:2,encounterIds:[1],assets:[]},41)).toThrow(/complete/);
    expect(()=>parseCopyPreparation({assets:[]},41)).toThrow(/complete/);
    expect(validCopyReceipt({created:{id:7},encounterNames:['Active'],encounterCount:1},2)).toBe(false);
    expect(validCopyReceipt({created:{id:7},encounterNames:[],encounterCount:0},0)).toBe(true);
  });
});
