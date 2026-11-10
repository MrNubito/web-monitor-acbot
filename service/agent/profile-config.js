const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const slotOptions = require('./profile-slot-options.json');
const slotGroups = {
  HOME_UPGRADE_SLOTS: 'HOME UPGRADES', HOME_UPGRADE_SLOT: 'HOME UPGRADES',
  HOME_RESEARCH_SLOTS: 'HOME RESEARCH', HOME_RESEARCH_SLOT: 'HOME RESEARCH',
  HOME_RESEARCH_PET_TARGET: 'PETS',
  BB_UPGRADE_SLOTS: 'BB UPGRADES', BB_UPGRADE_SLOT: 'BB UPGRADES',
  BB_RESEARCH_SLOTS: 'BB RESEARCH', BB_RESEARCH_SLOT: 'BB RESEARCH',
};
function slotLabel(value) {
  if (!value) return 'None (clear slot)';
  const group = String(value).match(/^__GROUP:(.+)__$/);
  if (group) return `Any ${group[1]}`;
  return String(value).replace(/^(home_upgrade_|home_research_|pet_upgrade_|bb_upgrade_|bb_research_)/, '').split('_').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
}
function slotEditor(key, value) {
  const group = slotGroups[key];
  if (!group) return null;
  if (!key.endsWith('_SLOTS')) return typeof value === 'string' ? { group, slots: null, current: value } : null;
  let slots = value;
  if (typeof value === 'string') { try { slots = JSON.parse(value); } catch { return null; } }
  return Array.isArray(slots) && slots.length && slots.every(v => typeof v === 'string') ? { group, slots, encoded: typeof value === 'string' } : null;
}
function potionSelection(value) {
  let items = value;
  if (typeof value === 'string') { try { items = JSON.parse(value); } catch { return null; } }
  return Array.isArray(items) && items.length <= 23 && items.every(v => typeof v === 'string') ? items : null;
}
function potionLabel(value) {
  return ({ builder: 'Builder Potion', research: 'Research Potion' })[value] || value;
}
const capitalChoices = {
  CLAN_CAPITAL_CUSTOM_TROOPS: ['Battle Ram', 'Flying Fortress', 'Hog Raiders', 'Inferno Dragon', 'Mega Sparky', 'Minion Horde', 'Mountain Golem', 'Power P.E.K.K.A', 'Raid Cart', 'Rocket Balloons', 'Skeleton Barrels', 'Sneaky Archers', 'Super Barbarian', 'Super Dragon', 'Super Giant', 'Super Miner', 'Super Wizard'],
  CLAN_CAPITAL_CUSTOM_SPELLS: ['Endless Haste Spell', 'Frost Spell', 'Graveyard Spell', 'Healing Spell', 'Jump Spell', 'Lightning Spell', 'Rage Spell'],
};
function capitalArmy(value) {
  let items = value;
  if (typeof value === 'string') { try { items = JSON.parse(value); } catch { return null; } }
  return Array.isArray(items) && items.every(v => v && typeof v === 'object' && !Array.isArray(v) && typeof v.name === 'string' && (v.count == null || typeof v.count === 'number')) ? items : null;
}
function capitalItemLabel(item) { return `${item.name} × ${item.count == null ? 'Auto' : item.count}`; }

const TTL = 30 * 60 * 1000;
const PAGE = 25;
const GLOBAL_PROFILE = '__global__';
function profileLabel(profile) { return profile === GLOBAL_PROFILE ? 'Global / Default (profiles/config.json)' : profile; }
const tabLayout = {
  "General": [
    "FARMING_ENABLED",
    "UPGRADE_WALLS",
    "WALL_STOP_LEVEL",
    "ATTACK_MIN_GOLD",
    "ATTACK_MIN_ELIXIR",
    "ATTACK_MIN_DARK",
    "REQUEST_DONATIONS",
    "WAIT_FOR_CC_TROOPS",
    "ENABLE_DONATIONS",
    "DONATION_MODE",
    "END_BATTLE_ON_STARS",
    "TARGET_STARS",
    "COLLECT_COLLECTORS",
    "START_HELPERS",
    "COLLECT_CART",
    "CLEAR_TOMBSTONES",
    "REMOVE_OBSTACLES",
    "COLLECT_ACHIEVEMENTS",
    "COLLECT_CC_LOOT",
    "CLAIM_WEEKLY_DEAL",
    "PLACE_UNPLACED_ITEMS",
    "WEEKLY_CLAIM_STARRY_ORE",
    "USE_POTIONS",
    "USE_POTIONS_SELECTED"
  ],
  "Attack Army": [
    "SELECTED_ATTACK_STRATEGY",
    "SELECTED_ARMY_SLOT",
    "HERO_TAP_DELAY_ENABLED",
    "HERO_TAP_DELAY_SECONDS",
    "AIR_TROOP_WIDTH_ENABLED",
    "AIR_TROOP_WIDTH",
    "AIR_TROOP_WIDTH_IS_PERCENT",
    "VALKYRIE_1SIDE_MULTITOUCH_EXTRA_MS_PER_TROOP"
  ],
  "Attack Army / Ranked-War Army": [
    "RANKED_ATTACK_STRATEGY",
    "RANKED_ARMY_SLOT"
  ],
  "Multi Village": [
    "MULTI_VILLAGE_ENABLED",
    "USE_ROOT_PROFILE_SWAP",
    "START_PROFILE",
    "VILLAGE_COUNT",
    "VILLAGE_SWITCH_CONDITION",
    "VILLAGE_SWITCH_MINUTES",
    "SWITCH_ON_LOOT_FULL"
  ],
  "Builder Base": [
    "BUILDER_ENABLED",
    "BUILDER_RETURN_HOME_WHEN",
    "BUILDER_ARMY_TROOP",
    "BUILDER_TARGET_STARS",
    "BUILDER_MAX_ATTACKS",
    "BB_TIMED_MINUTES",
    "BUILDER_END_AFTER_TROOP_DROP",
    "BUILDERBASE_UPGRADE_WALLS",
    "BUILDER_COLLECT_RESOURCES",
    "BUILDER_COLLECT_GEM_MINE",
    "BUILDER_BOOST_CLOCK_TOWER",
    "BB_REMOVE_OBSTACLES",
    "BUILDER_MODE",
    "COLLECT_BUILDER_COLLECTORS",
    "BUILDER_LOOT_CART_CHECK_INTERVAL"
  ],
  "Clan Capital": [
    "CLAN_CAPITAL",
    "CLAN_CAPITAL_TROOP",
    "CLAN_CAPITAL_CUSTOM_TROOPS",
    "CLAN_CAPITAL_CUSTOM_SPELLS",
    "CLAN_CAPITAL_DUMP_GOLD_TREASURY_IF_FULL"
  ],
  "Upgrades/Research / Home": [
    "HOME_RUSH_TH_ENABLED",
    "HOME_UPGRADE_ENABLED",
    "HOME_SAVE_1_BUILDER",
    "HOME_UPGRADE_PERFORM_SUGGESTED",
    "HOME_UPGRADE_SUGGESTED_IGNORE_TOWNHALL",
    "HOME_UPGRADE_SUGGESTED_ROTATE",
    "HOME_UPGRADE_SLOTS",
    "HOME_RESEARCH_ENABLED",
    "HOME_RESEARCH_USE_1_GEM_HELPER",
    "HOME_RESEARCH_PERFORM_SUGGESTED",
    "HOME_RESEARCH_SUGGESTED_ROTATE",
    "HOME_RESEARCH_SLOTS",
    "HOME_RESEARCH_SLOT",
    "HOME_RESEARCH_PETS",
    "HOME_RESEARCH_PET_TARGET"
  ],
  "Upgrades/Research / Builder Base": [
    "BB_RUSH_BH_ENABLED",
    "BB_UPGRADE_ENABLED",
    "BB_SAVE_1_BUILDER",
    "BB_UPGRADE_PERFORM_SUGGESTED",
    "BB_UPGRADE_SUGGESTED_ROTATE",
    "BB_UPGRADE_SLOTS",
    "BB_RESEARCH_ENABLED",
    "BB_RESEARCH_PERFORM_SUGGESTED",
    "BB_RESEARCH_SUGGESTED_ROTATE",
    "BB_RESEARCH_SLOTS",
    "BB_RESEARCH_SLOT"
  ],
  "Upgrades/Research / Equipment": [
    "EQUIPMENT_UPGRADE_ENABLED",
    "EQUIPMENT_UPGRADE_MODE",
    "EQUIPMENT_HERO_PRIORITY"
  ],
  "XP Farming": [
    "REQUEST_AND_LEAVE_ENABLED",
    "REQUEST_AND_LEAVE_JOIN",
    "REQUEST_AND_LEAVE_LEAVE",
    "REQUEST_AND_LEAVE_JOIN_LEAVE",
    "REQUEST_AND_LEAVE_CLAN_TAG",
    "REQUEST_AND_LEAVE_JOIN_MESSAGE",
    "REQUEST_AND_LEAVE_WAIT_FOR_COOLDOWN",
    "REQUEST_AND_LEAVE_SET_ARMY_SLOT1",
    "REQUEST_AND_LEAVE_ARMY_LINK",
    "DONATE_ONLY_ENABLED",
    "DONATE_ONLY_SPEED_MODE",
    "DONATE_ONLY_SPEED_TROOPS",
    "DONATE_ONLY_SPEED_SPELLS",
    "DONATE_ONLY_SPEED_ELIXIR_COST",
    "DONATE_ONLY_SPEED_DARK_COST",
    "ACCEPT_JOIN_REQUESTS",
    "ACCEPT_JOIN_REQUEST_KEYWORD"
  ],
  "Extra Modes": [
    "RANK_FIRST",
    "RANKED_REQUEST_DONATIONS",
    "RANKED_WAIT_FOR_CC_TROOPS",
    "CLAN_GAMES",
    "CG_TROOP_CHALLENGES",
    "CG_DISABLED_CHALLENGES",
    "CG_CLAIM_REWARDS_FOR_GEMS",
    "WAR_ATTACKS_ENABLED",
    "WAR_MODE",
    "WAR_CWL_ENABLED",
    "WAR_ATTACK1_TARGET",
    "WAR_ATTACK1_STARS",
    "WAR_ATTACK2_TARGET",
    "WAR_ATTACK2_STARS",
    "WAR_CWL_TARGET",
    "WAR_REQUEST_CC",
    "WAR_WAIT_FOR_CC",
    "WAR_ONE_ATTACK_PER_SESSION",
    "ACCOUNT_CREATION_COUNT",
    "ACCOUNT_CREATION_NAME",
    "ACCOUNT_CREATION_NUMERAL_SUFFIX"
  ],
  "Bot Runtime": [
    "BOT_END_CONDITION_ENABLED",
    "BOT_END_CONDITION_TYPE",
    "BOT_END_TIME_MINUTES",
    "ACTIVE_HOURS_ENABLED",
    "ACTIVE_HOURS_START",
    "ACTIVE_HOURS_END",
    "HUMANIZED_BREAKS_ENABLED",
    "HUMANIZED_RUN_MIN_MINUTES",
    "HUMANIZED_RUN_MAX_MINUTES",
    "HUMANIZED_BREAK_MIN_MINUTES",
    "HUMANIZED_BREAK_MAX_MINUTES"
  ],
  "Settings": [
    "EMULATOR_SELECTION",
    "EMULATOR_INSTANCE",
    "EMULATOR_INSTALL_PATHS",
    "EMULATOR_IP",
    "EMULATOR_PORT",
    "UI_LANGUAGE"
  ],
  "Advanced": []
};
const categories = Object.keys(tabLayout);
const keyLocations = new Map(Object.entries(tabLayout).flatMap(([tab, keys]) => keys.map((key, index) => [key, { tab, index }])));
const labels = {
  UPGRADE_WALLS: ['Upgrade walls', 'Allows resources to be spent on wall upgrades.'],
  HOME_UPGRADE_ENABLED: ['Upgrade buildings', 'Enables building upgrades in the home village.'],
  HOME_RESEARCH_ENABLED: ['Research troops', 'Enables laboratory research.'],
  HOME_SAVE_1_BUILDER: ['Reserve one builder', 'Keeps one builder available in the home village.'],
  FARMING_ENABLED: ['Enable farming', 'Enables farming attacks.'],
  ENABLE_DONATIONS: ['Enable donations', 'Allows troops to be donated.'],
  REQUEST_DONATIONS: ['Request donations', 'Allows troop requests to the clan.'],
  SELECTED_ATTACK_STRATEGY: ['Attack strategy', 'Selects the strategy used for attacks.'],
  SELECTED_ARMY_SLOT: ['Selected army', 'Army slot number in AutoClash.'],
  ATTACK_MIN_GOLD: ['Minimum gold', 'Minimum gold required when searching for a village to attack.'],
  ATTACK_MIN_ELIXIR: ['Minimum elixir', 'Minimum elixir required when searching for a village to attack.'],
  ATTACK_MIN_DARK: ['Minimum dark elixir', 'Minimum dark elixir required to accept a village.'],
  BUILDER_ENABLED: ['Builder Base attacks', 'Enables attacks in the Builder Base.'],
  CLAN_CAPITAL: ['Clan Capital', 'Enables Clan Capital mode.'],
  CLAN_CAPITAL_TROOP: ['Clan Capital troop mode', 'Miner uses the miner preset. Use Current keeps the current army. Custom uses the configured Clan Capital army troops and spells.'],
  CLAN_GAMES: ['Clan Games', 'Enables Clan Games.'],
  REMOVE_OBSTACLES: ['Remove obstacles', 'Allows obstacles to be removed.'],
  COLLECT_COLLECTORS: ['Collect resources', 'Collects resources from collectors.'],
  TARGET_STARS: ['Target stars', 'Target number of stars in an attack.'],
  HOME_UPGRADE_SLOTS: ['Home upgrade slots', 'Choose an upgrade for each home village slot.'],
  HOME_RESEARCH_SLOTS: ['Home research slots', 'Choose a research item for each home village slot.'],
  HOME_RESEARCH_SLOT: ['Home research target', 'Choose a home village research item.'],
  HOME_RESEARCH_PET_TARGET: ['Pet upgrade target', 'Choose a pet to upgrade.'],
  BB_UPGRADE_SLOTS: ['Builder Base upgrade slots', 'Choose an upgrade for each Builder Base slot.'],
  BB_RESEARCH_SLOTS: ['Builder Base research slots', 'Choose a research item for each Builder Base slot.'],
  BB_RESEARCH_SLOT: ['Builder Base research target', 'Choose a Builder Base research item.'],
  USE_POTIONS: ['Use Potions', 'Enable or disable potion usage for this profile. Select potion types separately.'],
  USE_POTIONS_SELECTED: ['Selected potions', 'Choose which potion types this profile may use: Builder Potion and Research Potion.'],
  CLAN_CAPITAL_CUSTOM_TROOPS: ['Clan Capital army troops', 'Choose troop types and optional counts. Leave the count blank for Auto.'],
  CLAN_CAPITAL_CUSTOM_SPELLS: ['Clan Capital army spells', 'Choose spell types and optional counts. Leave the count blank for Auto.'],
};
Object.assign(labels, {
  "WALL_STOP_LEVEL": [
    "Stop walls at level",
    "Stop wall upgrades at this level."
  ],
  "WAIT_FOR_CC_TROOPS": [
    "Wait 60s for CC",
    "Wait for Clan Castle troops after requesting donations."
  ],
  "PLACE_UNPLACED_ITEMS": [
    "Place unplaced items",
    "Place available unplaced items."
  ],
  "USE_ROOT_PROFILE_SWAP": [
    "Use Root Profile Swap",
    "Use the root profile swap option for Multi Village."
  ],
  "MULTI_VILLAGE_ENABLED": [
    "Enable Multi Village",
    "Enable switching between configured profiles."
  ],
  "START_PROFILE": [
    "Start Profile",
    "Profile to start with in Multi Village mode."
  ],
  "VILLAGE_COUNT": [
    "Village Count",
    "Number of villages in Multi Village mode."
  ],
  "VILLAGE_SWITCH_CONDITION": [
    "Switch Condition",
    "Condition used to switch villages."
  ],
  "VILLAGE_SWITCH_MINUTES": [
    "Switch Every (minutes)",
    "Interval between village switches."
  ],
  "RANKED_ATTACK_STRATEGY": [
    "Ranked Attack Strategy",
    "Strategy used by ranked and war armies."
  ],
  "RANKED_ARMY_SLOT": [
    "Ranked Army Slot",
    "Army slot used by ranked and war armies."
  ],
  "BB_TIMED_MINUTES": [
    "Timed Minutes",
    "Builder Base session duration in minutes."
  ],
  "BB_RUSH_BH_ENABLED": [
    "Rush BH",
    "Enable rushing the Builder Hall."
  ],
  "HOME_RUSH_TH_ENABLED": [
    "Rush TH",
    "Enable rushing the Town Hall."
  ],
  "EQUIPMENT_UPGRADE_ENABLED": [
    "Equipment Upgrade",
    "Enable hero equipment upgrades."
  ],
  "EQUIPMENT_UPGRADE_MODE": [
    "Equipment Upgrade Mode",
    "Choose the equipment upgrade mode."
  ],
  "EQUIPMENT_HERO_PRIORITY": [
    "Hero Priority Order",
    "Order used when upgrading hero equipment."
  ],
  "RANK_FIRST": [
    "Enable Ranked Attacks",
    "Enable ranked attacks."
  ],
  "WAR_ATTACKS_ENABLED": [
    "Enable War Attacks",
    "Enable war attacks."
  ],
  "WAR_CWL_ENABLED": [
    "Enable CWL",
    "Enable Clan War League attacks."
  ],
  "BOT_END_CONDITION_ENABLED": [
    "Enable Bot End Condition",
    "Enable a condition that ends the bot session."
  ],
  "BOT_END_CONDITION_TYPE": [
    "End Condition",
    "Condition that ends the bot session."
  ],
  "BOT_END_TIME_MINUTES": [
    "Time to End (minutes)",
    "Time limit for the bot end condition."
  ],
  "ACTIVE_HOURS_ENABLED": [
    "Enable Active Hours",
    "Run within the configured active hours."
  ],
  "ACTIVE_HOURS_START": [
    "Start (HH:MM)",
    "Start of active hours."
  ],
  "ACTIVE_HOURS_END": [
    "End (HH:MM)",
    "End of active hours."
  ],
  "HUMANIZED_BREAKS_ENABLED": [
    "Enable Humanized Breaks",
    "Enable randomized run and break periods."
  ]
});
const friendlyNames = {
  "HOME_UPGRADE_PERFORM_SUGGESTED": "Use Suggested Building Upgrades",
  "HOME_UPGRADE_SUGGESTED_IGNORE_TOWNHALL": "Ignore Town Hall in Suggestions",
  "HOME_UPGRADE_SUGGESTED_ROTATE": "Rotate Suggested Building Upgrades",
  "HOME_RESEARCH_PERFORM_SUGGESTED": "Use Suggested Research",
  "HOME_RESEARCH_SUGGESTED_ROTATE": "Rotate Suggested Research",
  "HOME_RESEARCH_PETS": "Upgrade Pets",
  "HOME_RESEARCH_USE_1_GEM_HELPER": "Use One-Gem Helper",
  "BB_UPGRADE_ENABLED": "Enable Builder Base Upgrades",
  "BB_SAVE_1_BUILDER": "Reserve One Builder",
  "BB_UPGRADE_PERFORM_SUGGESTED": "Use Suggested Builder Base Upgrades",
  "BB_UPGRADE_SUGGESTED_ROTATE": "Rotate Suggested Builder Base Upgrades",
  "BB_RESEARCH_ENABLED": "Enable Builder Base Research",
  "BB_RESEARCH_PERFORM_SUGGESTED": "Use Suggested Builder Base Research",
  "BB_RESEARCH_SUGGESTED_ROTATE": "Rotate Suggested Builder Base Research",
  "BUILDER_RETURN_HOME_WHEN": "Return Home When",
  "BUILDER_ARMY_TROOP": "Builder Base Army Troop",
  "BUILDER_TARGET_STARS": "Builder Base Target Stars",
  "BUILDER_MAX_ATTACKS": "Maximum Attacks per Session",
  "BUILDER_END_AFTER_TROOP_DROP": "End Battle After Troop Deployment",
  "BUILDERBASE_UPGRADE_WALLS": "Upgrade Builder Base Walls",
  "BUILDER_COLLECT_RESOURCES": "Collect Builder Base Resources",
  "BUILDER_COLLECT_GEM_MINE": "Collect Gem Mine",
  "BUILDER_BOOST_CLOCK_TOWER": "Boost Clock Tower",
  "BB_REMOVE_OBSTACLES": "Remove Builder Base Obstacles",
  "CLAN_CAPITAL_DUMP_GOLD_TREASURY_IF_FULL": "Deposit Capital Gold When Full",
  "CLAN_GAMES": "Enable Clan Games",
  "CG_TROOP_CHALLENGES": "Enable Super Troop Challenges",
  "CG_DISABLED_CHALLENGES": "Excluded Clan Games Challenges",
  "CG_CLAIM_REWARDS_FOR_GEMS": "Claim Rewards for Gems",
  "REQUEST_AND_LEAVE_ENABLED": "Enable Request and Dump",
  "REQUEST_AND_LEAVE_JOIN": "Join Clan",
  "REQUEST_AND_LEAVE_LEAVE": "Leave Clan",
  "REQUEST_AND_LEAVE_JOIN_LEAVE": "Join and Leave Clan",
  "REQUEST_AND_LEAVE_CLAN_TAG": "Clan Tag",
  "REQUEST_AND_LEAVE_JOIN_MESSAGE": "Join Request Message",
  "REQUEST_AND_LEAVE_WAIT_FOR_COOLDOWN": "Wait for Cooldown",
  "REQUEST_AND_LEAVE_SET_ARMY_SLOT1": "Set Army Slot 1",
  "REQUEST_AND_LEAVE_ARMY_LINK": "Army Share Link",
  "DONATE_ONLY_ENABLED": "Enable Donate Only",
  "DONATE_ONLY_SPEED_MODE": "Enable Donation Speed Mode",
  "DONATE_ONLY_SPEED_TROOPS": "Troop Tap Points",
  "DONATE_ONLY_SPEED_SPELLS": "Spell Tap Points",
  "DONATE_ONLY_SPEED_ELIXIR_COST": "Donation Elixir Cost",
  "DONATE_ONLY_SPEED_DARK_COST": "Donation Dark Elixir Cost",
  "ACCEPT_JOIN_REQUESTS": "Accept Clan Join Requests",
  "ACCEPT_JOIN_REQUEST_KEYWORD": "Join Request Keyword",
  "WAR_MODE": "War Mode",
  "WAR_ATTACK1_TARGET": "First War Attack Target",
  "WAR_ATTACK1_STARS": "First War Attack Stars",
  "WAR_ATTACK2_TARGET": "Second War Attack Target",
  "WAR_ATTACK2_STARS": "Second War Attack Stars",
  "WAR_CWL_TARGET": "CWL Attack Target",
  "WAR_REQUEST_CC": "Request War Donations",
  "WAR_WAIT_FOR_CC": "Wait for War Clan Castle Troops",
  "WAR_ONE_ATTACK_PER_SESSION": "One War Attack per Session",
  "RANKED_REQUEST_DONATIONS": "Request Ranked Donations",
  "RANKED_WAIT_FOR_CC_TROOPS": "Wait for Ranked Clan Castle Troops",
  "ACCOUNT_CREATION_COUNT": "Accounts to Create",
  "ACCOUNT_CREATION_NAME": "New Account Name",
  "ACCOUNT_CREATION_NUMERAL_SUFFIX": "Add Numeric Name Suffix",
  "HUMANIZED_RUN_MIN_MINUTES": "Minimum Run Duration",
  "HUMANIZED_RUN_MAX_MINUTES": "Maximum Run Duration",
  "HUMANIZED_BREAK_MIN_MINUTES": "Minimum Break Duration",
  "HUMANIZED_BREAK_MAX_MINUTES": "Maximum Break Duration",
  "EMULATOR_SELECTION": "Emulator",
  "EMULATOR_INSTANCE": "Emulator Instance",
  "EMULATOR_INSTALL_PATHS": "Emulator Install Paths",
  "EMULATOR_IP": "Emulator IP Address",
  "EMULATOR_PORT": "Emulator Port",
  "UI_LANGUAGE": "Interface Language"
};
const enumValues = {
  DONATION_MODE: ['hybrid', 'request', 'donate'],
  BUILDER_ARMY_TROOP: ['Baby Dragon', 'Raged Barbarian', 'Sneaky Archer', 'Boxer Giant', 'Beta Minion', 'Night Witch', 'Bomber', 'Cannon Cart', 'Drop Ship', 'Power P.E.K.K.A', 'Hog Glider'],
  BUILDER_RETURN_HOME_WHEN: ['Gold + Elixir Full', 'Gold Full', 'Elixir Full', 'Max Attacks Reached', 'Always'],
  CLAN_CAPITAL_TROOP: ['Miner', 'Use Current', 'Custom'],
  WAR_MODE: ['Normal', 'FWA', 'CWL', 'Friendly'],
};
function category(key) {
  if (keyLocations.has(key)) return keyLocations.get(key).tab;
  if (/^(REQUEST_AND_LEAVE_|DONATE_ONLY_|ACCEPT_JOIN_REQUEST|XP_)/.test(key)) return 'XP Farming';
  if (/^WAR_|^RANKED_|^CG_|^ACCOUNT_CREATION_|CLAN_GAMES/.test(key)) return 'Extra Modes';
  if (/^CLAN_CAPITAL/.test(key)) return 'Clan Capital';
  if (/^(BB_UPGRADE|BB_RESEARCH|BB_RUSH|BB_SAVE)/.test(key)) return 'Upgrades/Research / Builder Base';
  if (/^(EQUIPMENT_)/.test(key)) return 'Upgrades/Research / Equipment';
  if (/^HOME_(UPGRADE|RESEARCH|SAVE)/.test(key)) return 'Upgrades/Research / Home';
  return 'Advanced';
}
function compareOptionKeys(a, b) {
  const ai = keyLocations.get(a)?.index ?? 10000;
  const bi = keyLocations.get(b)?.index ?? 10000;
  return ai - bi || a.localeCompare(b);
}
function titleCase(text) {
  const acronyms = { bb: 'Builder Base', cc: 'Clan Castle', th: 'Town Hall', bh: 'Builder Hall', xp: 'XP', cwl: 'CWL', adb: 'ADB', ip: 'IP', ui: 'UI', hh: 'HH', mm: 'MM', json: 'JSON' };
  return String(text).replace(/\b[A-Za-z]+\b/g, word => acronyms[word.toLowerCase()] || word[0].toUpperCase() + word.slice(1).toLowerCase()).replace(/(\d+)S\b/g, '$1s');
}
function title(key) { return titleCase(friendlyNames[key] || labels[key]?.[0] || key.replaceAll('_', ' ')); }
function formattedValue(key, value, config = {}) {
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (value == null) return 'Auto';
  const slots = slotEditor(key, value);
  if (slots?.slots) return `${slots.slots.filter(Boolean).length} of ${slots.slots.length} slots set`;
  if (slots) return value ? slotLabel(value) : 'None selected';
  if (key === 'USE_POTIONS_SELECTED' && potionSelection(value)) return potionSelection(value).map(potionLabel).join(', ') || 'None selected';
  if (capitalChoices[key] && capitalArmy(value)) {
    const army = capitalArmy(value);
    return army.length ? `${army.length} ${key.endsWith('TROOPS') ? 'troop' : 'spell'} ${army.length === 1 ? 'entry' : 'entries'}` : 'No entries';
  }
  if (typeof value === 'number') {
    const number = value.toLocaleString('en-US', { maximumFractionDigits: 8 });
    if (key === 'WALL_STOP_LEVEL') return `Level ${number}`;
    if (/MINUTES/.test(key)) return `${number} min`;
    if (/SECONDS/.test(key)) return `${number} sec`;
    if (/MILLISECONDS|_MS_/.test(key)) return `${number} ms`;
    if (/MIN_GOLD|GOLD_COST/.test(key)) return `${number} gold`;
    if (/MIN_DARK|DARK_COST/.test(key)) return `${number} dark elixir`;
    if (/MIN_ELIXIR|ELIXIR_COST/.test(key)) return `${number} elixir`;
    if (/TARGET_STARS|ATTACK\d_STARS/.test(key)) return `${number} ${value === 1 ? 'star' : 'stars'}`;
    if (/ARMY_SLOT$/.test(key)) return `Slot ${number}`;
    if (key === 'AIR_TROOP_WIDTH') return config.AIR_TROOP_WIDTH_IS_PERCENT === false ? `${number} px` : `${number}%`;
    return number;
  }
  if (Array.isArray(value)) return value.length ? value.map(v => typeof v === 'object' ? 'Configured item' : formattedValue('', v)).join(', ') : 'None selected';
  if (typeof value === 'object') { const count = Object.keys(value).length; return count ? `${count} configured ${count === 1 ? 'item' : 'items'}` : 'Not configured'; }
  if (value === '') return 'Not set';
  if (/ATTACK_STRATEGY/.test(key)) return ({ edragon: 'Electro Dragon / Balloon', balloon: 'Balloons', dragon: 'Dragons', thrower: 'Throwers', valkyrie_1side: 'Valkyrie — One Side', valkyrie: 'Valkyries', sneaky: 'Sneaky Goblins', custom: 'Custom Army' })[value] || titleCase(value.replaceAll('_', ' '));
  if (key === 'DONATION_MODE') return ({ hybrid: 'Request and Donate', request: 'Request Only', donate: 'Donate Only' })[value] || value;
  if (key === 'BOT_END_CONDITION_TYPE') return ({ loot_full_all: 'All Resources Full', loot_full_gold: 'Gold Full', loot_full_elixir: 'Elixir Full', loot_full_dark: 'Dark Elixir Full', time: 'Time Limit' })[value] || titleCase(value.replaceAll('_', ' '));
  if (/^__GROUP:|^(home_upgrade_|home_research_|pet_upgrade_|bb_upgrade_|bb_research_)/.test(value)) return slotLabel(value);
  return /^[a-z][a-z0-9_]*$/.test(value) && value.includes('_') ? titleCase(value.replaceAll('_', ' ')) : value;
}
function editable(key) { return !/^(WALL_MIN_ELIXIR|WALL_MIN_GOLD|HOME_WALL_EXHAUSTED_STREAK|HOME_WALL_RECHECK_AFTER)$|TOKEN|PASSWORD|SECRET|LICENSE|API_KEY|__proto__|^constructor$|^prototype$/i.test(key); }
function short(value, n = 90) { return String(value).slice(0, n) || '(empty)'; }
function show(value) { return typeof value === 'boolean' ? (value ? 'Enabled' : 'Disabled') : typeof value === 'object' ? JSON.stringify(value) : String(value); }
function display(value, n = 130) { return short(show(value), n).replace(/[`*_~<>@\\]/g, '\\$&'); }
function digest(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function inside(parent, child) { const rel = path.relative(parent, child); return rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); }
function profilesRoot(root) {
  if (!root) throw Error('AutoClash folder was not found.');
  const realRoot = fs.realpathSync(root);
  const dir = fs.realpathSync(path.join(realRoot, 'profiles'));
  if (!inside(realRoot, dir)) throw Error('The profiles folder is outside AutoClash.');
  return dir;
}
function listProfiles(root) {
  const dir = profilesRoot(root);
  const named = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== GLOBAL_PROFILE && fs.existsSync(path.join(dir, e.name, 'config.json'))).map(e => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return fs.existsSync(path.join(dir, 'config.json')) ? [GLOBAL_PROFILE, ...named] : named;
}
function profileFile(root, profile) {
  if (typeof profile !== 'string' || !profile || profile.includes('/') || profile.includes('\\') || profile === '.' || profile === '..') throw Error('Invalid profile.');
  const dir = profilesRoot(root);
  const file = fs.realpathSync(profile === GLOBAL_PROFILE ? path.join(dir, 'config.json') : path.join(dir, profile, 'config.json'));
  if (!inside(dir, file)) throw Error('The profile is outside the allowed folder.');
  return file;
}
function readProfile(root, profile) {
  const file = profileFile(root, profile);
  if (fs.statSync(file).size > 1024 * 1024) throw Error('The file is too large for this editor.');
  const raw = fs.readFileSync(file, 'utf8');
  const config = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!config || Array.isArray(config) || typeof config !== 'object') throw Error('The config must contain a JSON object.');
  return { file, raw, config, hash: digest(raw) };
}
function choices(key, previous) {
  let values = typeof previous === 'boolean' ? [true, false] : enumValues[key];
  if (/ATTACK_STRATEGY/.test(key) && typeof previous === 'string') values = ['edragon', 'balloon', 'dragon', 'thrower', 'valkyrie_1side', 'valkyrie', 'sneaky', 'custom'];
  if (/TARGET_STARS/.test(key)) values = typeof previous === 'number' ? [1, 2, 3] : ['1', '2', '3'];
  if (!values) return null;
  return [...new Set([previous, ...values])].slice(0, PAGE);
}
function parseValue(previous, text) {
  if (typeof previous === 'string') return String(text);
  if (typeof previous === 'number') {
    if (!String(text).trim()) throw Error('Enter a number.');
    const value = Number(text);
    if (!Number.isFinite(value) || (Number.isInteger(previous) && !Number.isSafeInteger(value))) throw Error('Invalid number for this option.');
    return value;
  }
  if (typeof previous === 'boolean') throw Error('Use the Enabled/Disabled selector.');
  const value = JSON.parse(text);
  if (previous === null ? value !== null : Array.isArray(previous) ? !Array.isArray(value) : !value || Array.isArray(value) || typeof value !== 'object') throw Error('The value must keep its original type.');
  return value;
}
function saveProfile(session) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = readProfile(session.root, session.profile);
    if (current.file !== session.file) throw Error('The profile path changed. Reopen the profile before saving.');
    const conflicts = [];
    for (const [key, value] of session.changes) {
      if (!Object.hasOwn(session.config, key) || !editable(key)) throw Error('Invalid option.');
      if (!Object.hasOwn(current.config, key)) throw Error(`The option ${key} was removed from this profile. Reopen the profile before saving.`);
      // Ignore unrelated runtime updates and formatting changes. A key already
      // set to the requested value is also safe to save again.
      if (!isDeepStrictEqual(current.config[key], session.config[key]) && !isDeepStrictEqual(current.config[key], value)) conflicts.push(key);
    }
    if (conflicts.length) {
      const error = Error(`These options changed outside this editor: ${conflicts.slice(0, 8).map(title).join(', ')}. Review their current values below, then click Save changes again to apply your edits.`);
      error.currentProfile = current;
      throw error;
    }
    const next = current.config;
    for (const [key, value] of session.changes) Object.defineProperty(next, key, { value, enumerable: true, writable: true, configurable: true });
    const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const backup = `${current.file}.bak-discord-${suffix}`;
    const temp = `${current.file}.tmp-${suffix}`;
    try {
      fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
      if (digest(fs.readFileSync(current.file, 'utf8')) !== current.hash) continue;
      fs.writeFileSync(backup, current.raw, { flag: 'wx' });
      if (digest(fs.readFileSync(current.file, 'utf8')) !== current.hash) continue;
      fs.renameSync(temp, current.file);
      return backup;
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  throw Error('AutoClash is updating this profile continuously. Your edits are still pending; try Save changes again.');
}
function createProfileEditor({ request, rootForInstance, restartInstance, busy = () => false, favoritesFile = path.join(process.cwd(), 'profile-config-favorites.json') }) {
  const sessions = new Map();
  function favorites(user) {
    try { const all = JSON.parse(fs.readFileSync(favoritesFile, 'utf8')); return Array.isArray(all[user]) ? all[user].filter(x => typeof x === 'string' && editable(x)) : []; }
    catch { return []; }
  }
  function toggleFavorite(s) {
    let all = {}; try { all = JSON.parse(fs.readFileSync(favoritesFile, 'utf8')); } catch {}
    if (!all || Array.isArray(all) || typeof all !== 'object') all = {};
    const values = favorites(s.user);
    all[s.user] = values.includes(s.key) ? values.filter(k => k !== s.key) : [...values, s.key].slice(-200);
    const temp = favoritesFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(all, null, 2)); fs.renameSync(temp, favoritesFile);
  }
  function value(s, key) { return s.changes.has(key) ? s.changes.get(key) : s.config[key]; }
  function id(s, action) { return `pc:${s.id}:${s.rev}:${action}`; }
  function button(s, action, label, style = 2, disabled = false) { return { type: 2, custom_id: id(s, action), label, style, disabled }; }
  function row(...components) { return { type: 1, components }; }
  function select(s, action, placeholder, options) { return row({ type: 3, custom_id: id(s, action), placeholder, options, min_values: 1, max_values: 1 }); }
  function options(items, label = x => x) { return items.map((item, i) => ({ label: short(label(item), 100), value: String(i) })); }
  function nav(s, count) { return row(button(s, 'prev', 'Previous', 2, s.page === 0), button(s, 'next', 'Next', 2, (s.page + 1) * PAGE >= count), button(s, 'cancel', 'Close', 4)); }
  function load(s) {
    const loaded = readProfile(s.root, s.profile);
    Object.assign(s, loaded, { changes: new Map(), key: null, page: 0, query: '', category: 'General', mode: 'browse' });
    if (s.saved && (s.saved.profile !== s.profile || [...s.saved.changes].some(([key, v]) => !isDeepStrictEqual(s.config[key], v)))) s.saved = null;
  }
  function payload(s, note = '') {
    const components = [];
    let description = note ? `${note}\n\n` : '';
    if (s.mode === 'instances' || s.mode === 'profiles') {
      s.items = s.mode === 'instances' ? s.instances : listProfiles(s.root);
      s.page = Math.min(s.page, Math.max(0, Math.ceil(s.items.length / PAGE) - 1));
      s.visible = s.items.slice(s.page * PAGE, (s.page + 1) * PAGE);
      description += s.mode === 'instances' ? 'Select an AutoClash instance.' : `**Instance:** ${display(s.instance.label)}\nSelect the profile you want to edit.`;
      if (s.visible.length) components.push(select(s, s.mode === 'instances' ? 'instance' : 'profile', 'Select ' + (s.mode === 'instances' ? 'instance' : 'profile'), options(s.visible, x => typeof x === 'string' ? profileLabel(x) : x.label)));
      else description += '\nNo profiles with config.json were found.';
      description += `\nPage ${s.page + 1} of ${Math.max(1, Math.ceil(s.items.length / PAGE))}`;
      components.push(nav(s, s.items.length));
    } else {
      description += `**Instance:** ${display(s.instance.label)} · **Profile:** ${display(profileLabel(s.profile))}\n`;
      if (s.profile === GLOBAL_PROFILE) description += 'Default configuration used when no named profile is selected.\n';
      if (s.mode === 'review') {
        const changes = [...s.changes].flatMap(([key, after]) => {
          if (key === 'USE_POTIONS_SELECTED' && potionSelection(s.config[key]) && potionSelection(after)) {
            return [{ key, before: potionSelection(s.config[key]).map(potionLabel).join(', ') || 'None', after: potionSelection(after).map(potionLabel).join(', ') || 'None' }];
          }
          if (capitalChoices[key] && capitalArmy(s.config[key]) && capitalArmy(after)) {
            const beforeArmy = capitalArmy(s.config[key]); const afterArmy = capitalArmy(after);
            return Array.from({ length: Math.max(beforeArmy.length, afterArmy.length) }, (_, i) => i).flatMap(i => isDeepStrictEqual(beforeArmy[i], afterArmy[i]) ? [] : [{ key, before: beforeArmy[i] ? capitalItemLabel(beforeArmy[i]) : 'None', after: afterArmy[i] ? capitalItemLabel(afterArmy[i]) : 'None', slot: i + 1 }]);
          }
          const beforeSlots = slotEditor(key, s.config[key])?.slots;
          const afterSlots = slotEditor(key, after)?.slots;
          if (beforeSlots && afterSlots && beforeSlots.length === afterSlots.length) return afterSlots.flatMap((v, i) => v === beforeSlots[i] ? [] : [{ key, before: slotLabel(beforeSlots[i]), after: slotLabel(v), slot: i + 1 }]);
          return [{ key, before: s.config[key], after }];
        });
        s.reviewCount = changes.length;
        const lines = changes.slice(s.page * 10, s.page * 10 + 10).map(c => `**${display(title(c.key), 65)}${c.slot ? ' · Slot ' + c.slot : ''}**\n${display(c.slot ? c.before : formattedValue(c.key, c.before, s.config))} → **${display(c.slot ? c.after : formattedValue(c.key, c.after, s.config))}**`);
        description += `**Review ${changes.length} change(s)**\n\n${lines.join('\n\n') || 'No pending changes.'}\n\nPage ${s.page + 1} of ${Math.max(1, Math.ceil(changes.length / 10))}\nA backup will be saved. Restart AutoClash after saving to apply your changes.`;
        components.push(row(button(s, 'reviewprev', 'Previous', 2, !s.page), button(s, 'reviewnext', 'Next', 2, (s.page + 1) * 10 >= changes.length)));
        components.push(row(button(s, 'save', 'Save changes', 3, !changes.length), button(s, 'back', 'Keep editing'), button(s, 'discard', 'Discard changes', 4)));
      } else if (s.mode === 'option') {
        const current = value(s, s.key);
        const catalog = slotEditor(s.key, current);
        description += `**${display(title(s.key))}**\n${labels[s.key]?.[1] || `Configure ${title(s.key).toLowerCase()} for this profile.`}\n\n**Current Value:** ${display(formattedValue(s.key, current, { ...s.config, ...Object.fromEntries(s.changes) }), 1300)}${s.changes.has(s.key) ? '\n📝 Change pending save.' : ''}`;
        if (capitalChoices[s.key] && capitalArmy(current)) {
          const army = capitalArmy(current);
          const troop = s.key === 'CLAN_CAPITAL_CUSTOM_TROOPS';
          const kind = troop ? 'troop' : 'spell';
          s.armyIndex = army.length && s.armyIndex !== -1 ? Math.min(s.armyIndex || 0, army.length - 1) : -1;
          s.armyPage = s.armyIndex >= 0 ? Math.floor(s.armyIndex / 24) : s.armyPage || 0;
          s.armyVisible = army.map((_, i) => i).slice(s.armyPage * 24, (s.armyPage + 1) * 24);
          components.push(select(s, 'armyentry', s.armyIndex === -1 ? `Add ${kind}` : `${troop ? 'Troop' : 'Spell'} ${s.armyIndex + 1}`, [...s.armyVisible.map(i => ({ label: short(`${i + 1}. ${capitalItemLabel(army[i])}`, 100), value: String(i), default: s.armyIndex === i })), { label: `Add ${kind}`, value: '-1', default: s.armyIndex === -1 }]));
          const selectedName = army[s.armyIndex]?.name;
          s.armyNames = [...new Set([...capitalChoices[s.key], ...(selectedName ? [selectedName] : [])])];
          components.push(select(s, 'armyname', `Choose ${kind}`, s.armyNames.map((name, i) => ({ label: short(name, 100), value: String(i), default: name === selectedName }))));
          description += `\n\n**Army entries:** ${army.length}\n${army.slice(s.armyPage * 24, s.armyPage * 24 + 8).map((item, i) => `${s.armyPage * 24 + i + 1}. ${display(capitalItemLabel(item))}`).join('\n') || 'No entries. Choose a type to add one.'}\n**Count:** leave blank for Auto. Choose a type first, then set its count.`;
          components.push(row(button(s, 'armycount', 'Set count / Auto', 1, s.armyIndex < 0), button(s, 'armyremove', `Remove ${kind}`, 4, s.armyIndex < 0), button(s, 'armyclear', troop ? 'Clear troops' : 'Clear spells', 4, !army.length), button(s, 'armyprev', 'Previous entries', 2, !s.armyPage), button(s, 'armynext', 'Next entries', 2, (s.armyPage + 1) * 24 >= army.length)));
          components.push(row(button(s, 'back', 'Back'), button(s, 'review', `Review (${s.changes.size})`, 1), button(s, 'cancel', 'Close', 4)));
        } else if (s.key === 'USE_POTIONS_SELECTED' && potionSelection(current)) {
          const selected = potionSelection(current);
          s.potionChoices = [...new Set(['builder', 'research', ...selected])];
          components.push(row({ type: 3, custom_id: id(s, 'potions'), placeholder: 'Choose potions (one, both or none)', min_values: 0, max_values: s.potionChoices.length, options: s.potionChoices.map((v, i) => ({ label: short(potionLabel(v), 100), value: String(i), default: selected.includes(v) })) }));
          description += `\n\n**Selected:** ${selected.map(potionLabel).map(v => display(v)).join(', ') || 'None'}\nEnable **Use Potions** separately to allow potion usage. Choosing potion types does not enable it automatically.`;
          components.push(row(button(s, 'potionclear', 'Clear selection'), button(s, 'back', 'Back'), button(s, 'review', `Review (${s.changes.size})`, 1), button(s, 'cancel', 'Close', 4)));
        } else if (catalog) {
          s.slot = catalog.slots ? Math.min(s.slot || 0, catalog.slots.length - 1) : null;
          const selectedValue = catalog.slots ? catalog.slots[s.slot] : current;
          if (catalog.slots) {
            const slotPage = Math.floor(s.slot / PAGE);
            s.visibleSlots = catalog.slots.map((v, i) => i).slice(slotPage * PAGE, (slotPage + 1) * PAGE);
            components.push(select(s, 'slot', `Slot ${s.slot + 1}: ${short(slotLabel(selectedValue), 65)}`, s.visibleSlots.map(i => ({ label: `Slot ${i + 1}: ${short(slotLabel(catalog.slots[i]), 75)}`, value: String(i), default: i === s.slot }))));
          }
          const entries = [...new Set(['', ...slotOptions[catalog.group], selectedValue])].filter(v => !s.slotQuery || `${v} ${slotLabel(v)}`.toLowerCase().includes(s.slotQuery.toLowerCase()));
          s.choicePage = Math.min(s.choicePage || 0, Math.max(0, Math.ceil(entries.length / PAGE) - 1));
          s.visibleCatalog = entries.slice(s.choicePage * PAGE, (s.choicePage + 1) * PAGE);
          if (s.visibleCatalog.length) components.push(select(s, 'slotvalue', 'Choose upgrade or research', s.visibleCatalog.map((v, i) => ({ label: short(slotLabel(v), 100), value: String(i), description: !v ? 'Leave this slot empty' : v.startsWith('__GROUP:') ? 'Choose any available upgrade in this group' : 'Select this upgrade or research target', default: v === selectedValue }))));
          description += `\n\n**${catalog.group}** · ${entries.length} choices · page ${s.choicePage + 1} of ${Math.max(1, Math.ceil(entries.length / PAGE))}${s.slotQuery ? '\nSearch: ' + display(s.slotQuery) : ''}`;
          components.push(row(button(s, 'choiceprev', 'Previous', 2, !s.choicePage), button(s, 'choicenext', 'Next', 2, (s.choicePage + 1) * PAGE >= entries.length), button(s, 'slotsearch', 'Search upgrades', 1), ...(catalog.slots && catalog.slots.length > PAGE ? [button(s, 'slotprev', 'Previous slots', 2, s.slot < PAGE), button(s, 'slotnext', 'Next slots', 2, (Math.floor(s.slot / PAGE) + 1) * PAGE >= catalog.slots.length)] : [])));
          components.push(row(button(s, 'back', 'Back'), button(s, 'favorite', favorites(s.user).includes(s.key) ? 'Remove favorite' : 'Add favorite'), button(s, 'review', `Review (${s.changes.size})`, 1), button(s, 'cancel', 'Close', 4)));
        } else {
        s.values = choices(s.key, current);
        if (s.values) components.push(select(s, 'value', 'Select the new value', options(s.values, v => formattedValue(s.key, v, s.config))));
        components.push(row(...(!s.values ? [button(s, 'edit', typeof current === 'object' ? 'Edit advanced JSON' : 'Change value', 1)] : []), button(s, 'favorite', favorites(s.user).includes(s.key) ? 'Remove favorite' : 'Add favorite'), button(s, 'back', 'Back')));
        components.push(row(button(s, 'review', `Review (${s.changes.size})`, 1), button(s, 'cancel', 'Close', 4)));
        }
      } else {
        const cats = ['Favorites', ...categories];
        components.push(select(s, 'category', s.query ? 'Search: all categories' : s.category, options(cats)));
        s.items = Object.keys(s.config).filter(editable).filter(k => s.query ? `${k} ${title(k)} ${labels[k]?.[1] || ''}`.toLowerCase().includes(s.query.toLowerCase()) : s.category === 'Favorites' ? favorites(s.user).includes(k) : category(k) === s.category).sort(compareOptionKeys);
        s.page = Math.min(s.page, Math.max(0, Math.ceil(s.items.length / PAGE) - 1));
        s.visible = s.items.slice(s.page * PAGE, (s.page + 1) * PAGE);
        if (s.visible.length) components.push(select(s, 'option', 'Choose an option', s.visible.map((k, i) => ({ label: short(title(k), 100), value: String(i), description: short(formattedValue(k, value(s, k), { ...s.config, ...Object.fromEntries(s.changes) }), 100) }))));
        description += `**${s.query ? 'Search: ' + display(s.query) : s.category}** · ${s.items.length} options\nPage ${s.page + 1} of ${Math.max(1, Math.ceil(s.items.length / PAGE))}\n${s.changes.size} pending change(s).\n${s.visible.slice(0, 8).map(k => `${s.changes.has(k) ? '📝 ' : ''}${display(title(k), 55)}: **${display(formattedValue(k, value(s, k), { ...s.config, ...Object.fromEntries(s.changes) }), 70)}**`).join('\n')}`;
        components.push(nav(s, s.items.length));
        components.push(row(button(s, 'search', 'Search', 1), button(s, 'review', `Review (${s.changes.size})`, 1), button(s, 'reload', 'Reload'), button(s, 'profiles', 'Change profile', 2, !!s.changes.size)));
      }
    }
    if (s.saved && s.saved.profile === s.profile && ['browse', 'option'].includes(s.mode)) {
      description += `\n\n**Restart required:** close and reopen **${display(s.instance.label)}**, activate it, then click Start. This affects this AutoClash instance and all profiles it runs.`;
      components.push(row(button(s, 'restart', 'Restart AutoClash', 3, !!s.changes.size || s.restarting)));
    }
    return { embeds: [{ title: '⚙ Profile configuration', description: description.slice(0, 4096), color: 5869055, footer: { text: 'Private panel · 30-minute session · save changes, then restart AutoClash' } }], components, allowed_mentions: { parse: [] } };
  }
  async function callback(control, interaction, type, data) {
    return request(control.token, `/interactions/${interaction.id}/${interaction.token}/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, data }) });
  }
  async function handle(control, interaction) {
    const custom = interaction.data?.custom_id || '';
    const start = custom === 'profile-config:open' || (interaction.type === 2 && interaction.data?.name === 'autoclash-config');
    if (!start && !custom.startsWith('pc:')) return false;
    let acknowledged = false;
    let authorized = false;
    const reply = async (type, data) => { const result = await callback(control, interaction, type, data); acknowledged = true; return result; };
    try {
      if (!control.uploadGuildId || interaction.guild_id !== control.uploadGuildId || !(BigInt(interaction.member?.permissions || '0') & 8n)) throw Error('This editor is available to administrators of the configured server.');
      authorized = true;
      if (busy()) throw Error('An AutoClash update is in progress. Try again when it finishes.');
      const user = interaction.member?.user?.id || interaction.user?.id;
      const now = Date.now();
      for (const [sid, old] of sessions) if (now - old.created > TTL) sessions.delete(sid);
      if (start) {
        for (const [sid, old] of sessions) if (old.user === user) sessions.delete(sid);
        const s = { id: crypto.randomBytes(8).toString('hex'), user, guild: interaction.guild_id, created: now, rev: 0, instances: control.instances, mode: 'instances', page: 0, changes: new Map() };
        sessions.set(s.id, s);
        await reply(4, { ...payload(s), flags: 64 }); return true;
      }
      const [, sid, revision, action] = custom.split(':');
      const s = sessions.get(sid);
      if (!s || s.user !== user || s.guild !== interaction.guild_id) throw Error('This session expired or belongs to another user. Open Configuration again.');
      if (s.restarting) throw Error('This AutoClash instance is already restarting. Wait for the result.');
      if (Number(revision) !== s.rev) throw Error('This control belongs to an earlier screen. Use the latest panel.');
      if (!['search', 'edit', 'slotsearch', 'armycount'].includes(action)) s.rev++;
      const selected = Number(interaction.data?.values?.[0]);
      const selectedItem = list => {
        if (!Number.isInteger(selected) || selected < 0 || selected >= list.length) throw Error('Invalid selection.');
        return list[selected];
      };
      if (action === 'cancel') { sessions.delete(sid); await reply(7, { content: 'Editor closed. Pending changes were discarded.', embeds: [], components: [], allowed_mentions: { parse: [] } }); return true; }
      if (action === 'armycount') {
        const army = capitalChoices[s.key] && capitalArmy(value(s, s.key));
        if (!army || !army[s.armyIndex]) throw Error('Choose an army entry before setting its count.');
        await reply(9, { custom_id: id(s, 'armycountsubmit'), title: short(army[s.armyIndex].name + ' count', 45), components: [{ type: 18, label: 'Count (blank = Auto)', description: 'Leave empty for Auto, or enter a positive whole number.', component: { type: 4, custom_id: 'input', style: 1, required: false, value: army[s.armyIndex].count == null ? '' : String(army[s.armyIndex].count), max_length: 10 } }] });
        return true;
      }
      if (action === 'search' || action === 'edit' || action === 'slotsearch') {
        const search = action !== 'edit';
        const current = search ? (action === 'slotsearch' ? s.slotQuery || '' : s.query) : value(s, s.key);
        const initial = search ? current : typeof current === 'object' ? JSON.stringify(current, null, 2) : String(current);
        if (initial.length > 4000) throw Error('This option is too large for a Discord form. Use the mobile editor.');
        await reply(9, { custom_id: id(s, action === 'slotsearch' ? 'slotsearchsubmit' : search ? 'searchsubmit' : 'editsubmit'), title: action === 'slotsearch' ? 'Search upgrades and research' : search ? 'Search for an option' : short(title(s.key), 45), components: [{ type: 18, label: search ? 'Name or keyword' : 'New value', description: action === 'slotsearch' ? 'Example: archer queen, supercharged, dragon. Leave empty to show all.' : search ? 'Example: walls, donations, ATTACK' : typeof current === 'object' ? 'Advanced: enter valid JSON of the same type.' : 'Keep the current value type.', component: { type: 4, custom_id: 'input', style: typeof current === 'object' ? 2 : 1, required: !search && typeof current !== 'string', value: initial, max_length: search ? 100 : 4000 } }] });
        return true;
      }
      let note = '';
      if (action === 'restart') {
        if (!restartInstance || !s.saved || s.saved.profile !== s.profile || s.changes.size) throw Error('Save your changes before restarting AutoClash.');
        const saved = s.saved;
        const current = readProfile(s.root, s.profile);
        if (current.file !== saved.file || [...saved.changes].some(([key, v]) => !isDeepStrictEqual(current.config[key], v))) throw Error('One of your saved options changed. Reload and review the profile before restarting.');
        s.restarting = true;
        try {
          await reply(7, { content: `Restarting **${display(s.instance.label)}**: closing AutoClash, reopening, activating and clicking Start. Please wait…`, embeds: [], components: [], allowed_mentions: { parse: [] } });
          let result;
          try {
            result = await restartInstance(control, s.instance, async () => {
              // Some AutoClash versions save cached settings on exit. Reapply
              // only the approved keys, preserving other settings and backing up.
              const closed = readProfile(s.root, saved.profile);
              if (closed.file !== saved.file) throw Error('The profile path changed while restarting.');
              const changes = new Map([...saved.changes].filter(([key, v]) => JSON.stringify(closed.config[key]) !== JSON.stringify(v)));
              if (changes.size) saveProfile({ ...closed, root: s.root, profile: saved.profile, changes });
              saved.hash = readProfile(s.root, saved.profile).hash;
            });
            s.saved = null;
            load(s);
            note = `✅ ${result || 'AutoClash restarted and Start was clicked.'}`;
          } catch (error) {
            note = `⚠ Restart failed: ${error.message}. Review the error and retry Restart AutoClash, or restart this instance manually.`;
          }
          s.restarting = false;
          s.rev++;
          await request(control.token, `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(s, note)) });
        } finally { s.restarting = false; }
        return true;
      }
      if (action === 'instance') { const instance = selectedItem(s.visible); const root = rootForInstance(instance); profilesRoot(root); s.instance = instance; s.root = root; s.mode = 'profiles'; s.page = 0; }
      else if (action === 'profile') { s.profile = selectedItem(s.visible); if (s.saved?.profile !== s.profile) s.saved = null; load(s); }
      else if (action === 'prev' || action === 'next') s.page = Math.max(0, s.page + (action === 'next' ? 1 : -1));
      else if (action === 'category') { s.category = selectedItem(['Favorites', ...categories]); s.query = ''; s.page = 0; }
      else if (action === 'option') { s.key = selectedItem(s.visible); s.mode = 'option'; s.slot = 0; s.choicePage = 0; s.slotQuery = ''; s.armyIndex = 0; s.armyPage = 0; }
      else if (['armyentry', 'armyname', 'armycountsubmit', 'armyremove', 'armyclear', 'armyprev', 'armynext'].includes(action)) {
        const current = value(s, s.key);
        const army = capitalChoices[s.key] && capitalArmy(current);
        if (!army) throw Error('Invalid Clan Capital army option.');
        const next = army.map(item => ({ ...item }));
        if (action === 'armyentry') {
          if (selected !== -1 && !s.armyVisible.includes(selected)) throw Error('Invalid army entry.');
          s.armyIndex = selected;
        } else if (action === 'armyprev' || action === 'armynext') {
          s.armyPage = Math.max(0, Math.min(Math.ceil(army.length / 24) - 1, (s.armyPage || 0) + (action === 'armynext' ? 1 : -1)));
          s.armyIndex = army.length ? s.armyPage * 24 : -1;
        } else {
          if (action === 'armyname') {
            const name = selectedItem(s.armyNames || []);
            if (s.armyIndex === -1) { next.push({ name, count: null }); s.armyIndex = next.length - 1; }
            else {
              if (!next[s.armyIndex]) throw Error('Invalid army entry.');
              next[s.armyIndex].name = name;
            }
          } else if (action === 'armycountsubmit') {
            if (!next[s.armyIndex]) throw Error('Invalid army entry.');
            const input = interaction.data.components?.flatMap(c => c.component ? [c.component] : c.components || []).find(c => c.custom_id === 'input');
            const text = String(input?.value || '').trim();
            const count = text === '' ? null : Number(text);
            if (count !== null && (!/^\d+$/.test(text) || !Number.isSafeInteger(count) || count < 1)) throw Error('Enter a positive whole number, or leave the count blank for Auto.');
            next[s.armyIndex].count = count;
          } else if (action === 'armyremove') {
            if (!next[s.armyIndex]) throw Error('Invalid army entry.');
            next.splice(s.armyIndex, 1); s.armyIndex = Math.min(s.armyIndex, next.length - 1);
          } else { next.length = 0; s.armyIndex = -1; s.armyPage = 0; }
          const encoded = typeof current === 'string' ? JSON.stringify(next) : next;
          if (isDeepStrictEqual(encoded, s.config[s.key])) s.changes.delete(s.key); else s.changes.set(s.key, encoded);
        }
      }
      else if (action === 'potions' || action === 'potionclear') {
        const current = value(s, s.key);
        if (s.key !== 'USE_POTIONS_SELECTED' || !potionSelection(current)) throw Error('Invalid potion selection.');
        const indices = action === 'potionclear' ? [] : interaction.data.values;
        if (!Array.isArray(indices) || !s.potionChoices) throw Error('Invalid potion selection.');
        const selectedValues = indices.map(index => {
          const i = Number(index);
          if (!Number.isInteger(i) || i < 0 || i >= s.potionChoices.length) throw Error('Invalid potion type.');
          return s.potionChoices[i];
        });
        const items = [...new Set(selectedValues)];
        const next = typeof current === 'string' ? JSON.stringify(items) : items;
        if (isDeepStrictEqual(next, s.config[s.key])) s.changes.delete(s.key); else s.changes.set(s.key, next);
      }
      else if (action === 'slot') {
        if (!s.visibleSlots?.includes(selected)) throw Error('Invalid slot.');
        s.slot = selected; s.choicePage = 0;
      } else if (action === 'choiceprev' || action === 'choicenext') s.choicePage = Math.max(0, (s.choicePage || 0) + (action === 'choicenext' ? 1 : -1));
      else if (action === 'slotprev' || action === 'slotnext') {
        const catalog = slotEditor(s.key, value(s, s.key));
        if (!catalog?.slots) throw Error('Invalid slot list.');
        s.slot = Math.min(catalog.slots.length - 1, Math.max(0, (Math.floor(s.slot / PAGE) + (action === 'slotnext' ? 1 : -1)) * PAGE));
        s.choicePage = 0;
      } else if (action === 'slotsearchsubmit') {
        const input = interaction.data.components?.flatMap(c => c.component ? [c.component] : c.components || []).find(c => c.custom_id === 'input');
        s.slotQuery = String(input?.value || '').trim(); s.choicePage = 0;
      } else if (action === 'slotvalue') {
        const catalog = slotEditor(s.key, value(s, s.key));
        if (!catalog || !editable(s.key)) throw Error('Invalid slot option.');
        const chosen = selectedItem(s.visibleCatalog || []);
        if (chosen && !slotOptions[catalog.group].includes(chosen) && chosen !== (catalog.slots ? catalog.slots[s.slot] : catalog.current)) throw Error('Invalid upgrade for this slot.');
        let next = chosen;
        if (catalog.slots) {
          const slots = [...catalog.slots]; slots[s.slot] = chosen;
          next = catalog.encoded ? JSON.stringify(slots) : slots;
        }
        if (isDeepStrictEqual(next, s.config[s.key])) s.changes.delete(s.key); else s.changes.set(s.key, next);
      }
      else if (action === 'value' || action === 'editsubmit') {
        if (!s.key || !editable(s.key) || !Object.hasOwn(s.config, s.key)) throw Error('Invalid option.');
        let next;
        if (action === 'value') next = selectedItem(s.values || []);
        else {
          const input = interaction.data.components?.flatMap(c => c.component ? [c.component] : c.components || []).find(c => c.custom_id === 'input');
          next = parseValue(s.config[s.key], input?.value ?? '');
        }
        if (JSON.stringify(next) === JSON.stringify(s.config[s.key])) s.changes.delete(s.key); else s.changes.set(s.key, next);
        s.mode = 'option';
      } else if (action === 'searchsubmit') {
        const input = interaction.data.components?.flatMap(c => c.component ? [c.component] : c.components || []).find(c => c.custom_id === 'input');
        s.query = String(input?.value || '').trim(); s.page = 0; s.mode = 'browse';
      } else if (action === 'favorite') toggleFavorite(s);
      else if (action === 'review') { s.mode = 'review'; s.page = 0; }
      else if (action === 'reviewprev' || action === 'reviewnext') s.page = Math.max(0, Math.min(Math.ceil((s.reviewCount || s.changes.size) / 10) - 1, s.page + (action === 'reviewnext' ? 1 : -1)));
      else if (action === 'back') { s.mode = 'browse'; s.page = 0; }
      else if (action === 'profiles') { if (s.changes.size) throw Error('Save or discard your changes first.'); s.mode = 'profiles'; s.page = 0; }
      else if (action === 'discard') { load(s); note = 'Changes discarded.'; }
      else if (action === 'reload') {
        if (s.changes.size) { s.mode = 'review'; s.page = 0; note = 'There are pending changes. Use Discard changes to reload without saving them.'; }
        else { load(s); note = 'Profile reloaded from disk.'; }
      } else if (action === 'save') {
        if (s.mode !== 'review' || !s.changes.size) throw Error('Review your changes before saving.');
        const approved = new Map([...(s.saved?.profile === s.profile ? s.saved.changes : []), ...s.changes]);
        let backup;
        try { backup = saveProfile(s); }
        catch (error) {
          if (error.currentProfile) {
            Object.assign(s, error.currentProfile);
            s.mode = 'review'; s.page = 0;
          }
          throw error;
        }
        load(s);
        s.saved = { profile: s.profile, file: s.file, hash: s.hash, changes: approved };
        note = `✅ Configuration saved. Backup: \`${path.basename(backup)}\`.\nClick **Restart AutoClash** below to apply your changes. The instance will close, reopen, activate and click Start.`;
      } else throw Error('Invalid action.');
      await reply(7, payload(s, note));
    } catch (error) {
      if (acknowledged) throw error;
      // Keep validation errors recoverable: refresh the private editor with the
      // next revision, rather than stranding the user on stale controls.
      const sid = custom.split(':')[1];
      const s = sessions.get(sid);
      const user = interaction.member?.user?.id || interaction.user?.id;
      if (authorized && s && s.user === user && s.guild === interaction.guild_id && custom.startsWith('pc:') && Number(custom.split(':')[2]) === s.rev - 1) {
        await reply(7, payload(s, '⚠ ' + error.message));
      } else await reply(4, { content: short(error.message, 1800), flags: 64, allowed_mentions: { parse: [] } });
    }
    return true;
  }
  return { handle };
}
module.exports = { editable, createProfileEditor, readProfile, saveProfile, listProfiles, parseValue, category, choices, slotEditor, slotLabel, optionName: title, formattedValue };
