const DESCRIPTIONS: Record<string, string> = {
  SKILL_ACROBATICS: 'Acrobatics measures your ability to perform tasks requiring coordination and grace. When you use the Escape basic action, you can use your Acrobatics modifier instead of your unarmed attack modifier. You can also use it for the basic actions Arrest a Fall and Grab an Edge instead of Reflex.',
  SKILL_ARCANA: 'Arcana measures how much you know about arcane magic and creatures. Even if you are untrained, you can Recall Knowledge.',
  SKILL_ATHLETICS: 'Athletics allows you to perform deeds of physical prowess. Most Athletics actions let you move about the environment or control your opponent\'s movement in combat. When you use the Escape basic action, you can use your Athletics modifier instead of your unarmed attack modifier.',
  SKILL_CRAFTING: 'You can use this skill to create and repair items. Even if you are untrained, you can Recall Knowledge.',
  SKILL_DECEPTION: 'You can trick and mislead others using disguises, lies, and other forms of subterfuge. Deception often has a drawback if you get found out, and it is often best to be out of town by the time this happens.',
  SKILL_DIPLOMACY: 'You influence others through negotiation and flattery, or find out information through friendly chats.',
  SKILL_INTIMIDATION: 'You bend others to your will using threats. Unlike Deception or Diplomacy, Intimidation is typically a blunt instrument with little room for nuance or care.',
  SKILL_MEDICINE: 'You can patch up wounds and help people recover from diseases and poisons. Treat Wounds is especially useful, allowing your adventuring party to heal up between fights. It can be made more efficient with skill feats like Continual Recovery and Ward Medic. Even if you are untrained in Medicine, you can use it to Recall Knowledge.',
  SKILL_NATURE: 'You know about the natural world, and you command and train animals and magical beasts. Even if you are untrained in Nature, you can use it to Recall Knowledge.',
  SKILL_OCCULTISM: 'You know a great deal about ancient philosophies, esoteric lore, obscure mysticism, and supernatural creatures. Even if you are untrained in Occultism, you can use it to Recall Knowledge.',
  SKILL_PERFORMANCE: 'You are skilled at a form of performance, using your talents to impress a crowd or make a living. Some performances require you to be more than just charismatic, and if you do not meet the demands of the art form or the audience, the GM might apply a penalty based on the relevant attribute.',
  SKILL_RELIGION: 'The secrets of deities, dogma, faith, and the realms of divine creatures both sublime and sinister are open to you. You also understand how magic works, though your training imparts a religious slant to that knowledge. Even if you are untrained in Religion, you can use it to Recall Knowledge.',
  SKILL_SOCIETY: 'You understand the people and systems that make civilization run, and you know the historical events that make societies what they are today. You can use that knowledge to navigate the complex physical, societal, and economic workings of settlements. Even if you are untrained in Society, you can use it to Recall Knowledge and Subsist.',
  SKILL_STEALTH: 'You are skilled at avoiding detection, allowing you to slip past foes, hide, or conceal an item.',
  SKILL_SURVIVAL: 'You are adept at living in the wilderness, foraging for food and building shelter, and with training you discover the secrets of tracking and hiding your trail. Even if you are untrained, you can still use Survival to Subsist.',
  SKILL_THIEVERY: 'You are trained in a particular set of skills favored by thieves and miscreants.',
};

const LORE_DESCRIPTION = 'You have specialized information on a narrow topic. Lore features many subcategories. The GM determines which subcategories apply, and each should remain narrower than a general skill. When multiple Lore subcategories or a non-Lore skill could apply, you can use whichever skill you prefer. Even if you are untrained in Lore, you can use it to Recall Knowledge.';

export function getPhase1SkillDescription(variableName: string) {
  if (variableName.startsWith('SKILL_LORE_')) return LORE_DESCRIPTION;
  return DESCRIPTIONS[variableName] ?? 'No description is available for this skill.';
}
