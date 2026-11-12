import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_DISCONNECT_PHRASE, DEFAULT_GREETING, DEFAULT_SYSTEM_TOOLS,
    archetypeChangeSummary, archetypeToEditorPartial, buildPersistedSettings, buildReadinessChecks, clampInt, clampPace,
    finalizeSettingsForSave, hasReplaceableContent, languageVoiceCounts, mergeSystemTools,
    pickSavedToolsConfig, restoreGreeting, restorePromptState, restoreSettings, splitSavedSettings,
    toolRequestBody, validateVariableName,
} from '../../src/pages/pearl/lib/agentEditorState.js';

test('saved system-tool switches are restored by id; new built-ins keep their default', () => {
    const saved = [{ id: 'whatsapp', enabled: false }, { id: 'webhook', enabled: true }, { id: 'retired', enabled: true }];
    const merged = mergeSystemTools(DEFAULT_SYSTEM_TOOLS, saved);
    assert.equal(merged.length, DEFAULT_SYSTEM_TOOLS.length);
    assert.equal(merged.find((t) => t.id === 'whatsapp').enabled, false);
    assert.equal(merged.find((t) => t.id === 'webhook').enabled, true);
    assert.equal(merged.find((t) => t.id === 'calendar').enabled, true);
    assert.deepEqual(mergeSystemTools(DEFAULT_SYSTEM_TOOLS, null).map((t) => t.enabled), DEFAULT_SYSTEM_TOOLS.map((t) => t.enabled));
});

test('tools_config is read from the top level, else from voice_config', () => {
    assert.deepEqual(pickSavedToolsConfig({ tools_config: [{ id: 'a' }] }), [{ id: 'a' }]);
    assert.deepEqual(pickSavedToolsConfig({ tools_config: [], voice_config: { tools_config: [{ id: 'b' }] } }), [{ id: 'b' }]);
    assert.equal(pickSavedToolsConfig({}), null);
});

test('directives and greeting draft survive a reload in both prompt modes', () => {
    const { settings, ui } = splitSavedSettings({ temperature: 0.3, promptMode: 'custom', fineTuningDirectives: 'Mention the pilot', greetingDraft: 'Hello {{lead_name}}' });
    assert.deepEqual(settings, { temperature: 0.3 });
    const custom = restorePromptState('You are Pearl, a careful closer.', ui);
    assert.equal(custom.promptMode, 'custom');
    assert.equal(custom.systemPrompt, 'You are Pearl, a careful closer.');
    assert.equal(custom.fineTuningDirectives, 'Mention the pilot');

    const expert = restorePromptState('Mention the pilot', { promptMode: 'expert', fineTuningDirectives: '', customPromptDraft: 'My old custom prompt' });
    assert.equal(expert.promptMode, 'expert');
    assert.equal(expert.fineTuningDirectives, 'Mention the pilot');
    assert.equal(expert.systemPrompt, 'My old custom prompt');

    assert.deepEqual(restoreGreeting(null, ui), { greetingEnabled: false, greetingText: 'Hello {{lead_name}}' });
    assert.deepEqual(restoreGreeting('Namaste!', ui), { greetingEnabled: true, greetingText: 'Namaste!' });
    assert.deepEqual(restoreGreeting('', {}), { greetingEnabled: false, greetingText: DEFAULT_GREETING });
});

test('persisted settings keep the drafts, clamp numbers and never save an empty exit phrase', () => {
    const persisted = buildPersistedSettings({
        settings: { maxCallLength: 999, disconnectPhrase: '   ', nudges: [{ id: 1, message: 'hi', afterSeconds: '' }] },
        promptMode: 'expert',
        fineTuningDirectives: '  Be brief  ',
        greetingText: 'Draft greeting',
        systemPrompt: 'custom text',
    });
    assert.equal(persisted.maxCallLength, 60);
    assert.equal(persisted.disconnectPhrase, DEFAULT_DISCONNECT_PHRASE);
    assert.equal(persisted.nudges[0].afterSeconds, 5);
    assert.equal(persisted.fineTuningDirectives, 'Be brief');
    assert.equal(persisted.greetingDraft, 'Draft greeting');
    assert.equal(persisted.customPromptDraft, 'custom text');
    assert.equal(buildPersistedSettings({ settings: {}, promptMode: 'custom', systemPrompt: 'x' }).customPromptDraft, undefined);
    assert.equal(finalizeSettingsForSave({ maxCallLength: 0 }).maxCallLength, 1);
    assert.equal(finalizeSettingsForSave({ disconnectPhrase: 'Bye!' }).disconnectPhrase, 'Bye!');
});

test('restoreSettings validates saved values over the defaults', () => {
    const s = restoreSettings({ bargeIn: 'yes', temperature: '0.8', maxCallLength: '', nudges: [{ message: 'Hello?', afterSeconds: 7 }, 'bad'], custom_key: 1 });
    assert.equal(s.bargeIn, true); // non-boolean ignored → default
    assert.equal(s.temperature, 0.8);
    assert.equal(s.maxCallLength, 15);
    assert.equal(s.nudges.length, 1);
    assert.equal(s.nudges[0].afterSeconds, 7);
    assert.equal(s.custom_key, 1);
});

test('number helpers', () => {
    assert.equal(clampInt('', { min: 1, max: 60, fallback: 15 }), 15);
    assert.equal(clampInt('75', { min: 1, max: 60, fallback: 15 }), 60);
    assert.equal(clampInt(-3, { min: 1, max: 60, fallback: 15 }), 1);
    assert.equal(clampPace('abc'), 1);
    assert.equal(clampPace(3), 1.5);
    assert.equal(clampPace(0.72), 0.72);
});

test('variable names: no empty, no invalid characters, no silent overwrite of an existing key', () => {
    assert.equal(validateVariableName('  prospect title ', []).name, 'prospect_title');
    assert.equal(validateVariableName('lead_name', ['lead_name']).ok, false);
    assert.equal(validateVariableName('!!!', []).ok, false);
    assert.equal(validateVariableName('', []).ok, false);
    assert.equal(validateVariableName('a'.repeat(70), []).ok, false);
});

test('blueprint confirmation lists what is replaced and never renames a saved agent', () => {
    const archetype = {
        id: 'b2b_discovery_qualifier', name: 'B2B Discovery', category: 'B2B & SaaS', defaultRole: 'outbound_qualification',
        mission: 'Book demos', greeting: 'Hi there', defaultVoiceId: 'ritu_hi_sales', defaultLanguage: 'Hindi', defaultPace: 1.0, defaultTone: 'Professional',
    };
    const state = { agentName: 'My Agent', role: 'inbound_support', mission: '', systemPrompt: 'long custom prompt', greetingText: 'x', speaker: 'shubh_enhi_ads', language: 'Auto', pace: 1, tone: 'Professional' };
    const existing = archetypeChangeSummary(archetype, state, { isExistingAgent: true });
    assert.ok(!existing.some((c) => c.startsWith('Name')));
    assert.ok(existing.some((c) => c.startsWith('Custom prompt')));
    assert.ok(existing.includes('Role'));
    assert.ok(existing.includes('Voice persona'));
    assert.ok(archetypeChangeSummary(archetype, state, { isExistingAgent: false }).some((c) => c.startsWith('Name')));
    assert.equal(hasReplaceableContent({}, { isExistingAgent: true }), true);
    assert.equal(hasReplaceableContent({ systemPrompt: '', fineTuningDirectives: '', greetingEnabled: false }, {}), false);
    assert.equal(hasReplaceableContent({ systemPrompt: 'something' }, {}), true);
});

test('readiness checks reflect the real state (not always green)', () => {
    const base = {
        agentName: 'Pearl', promptMode: 'custom', systemPrompt: 'short', greetingEnabled: true, greetingText: ' ',
        speaker: 'ghost_voice', language: 'Auto', pace: 1, capsuleId: '', testVariables: { lead_name: '' },
    };
    const checks = buildReadinessChecks(base, { voiceIds: ['shubh_enhi_ads'], detectedVariables: [{ name: 'lead_name', fallback: '' }, { name: 'company', fallback: 'Acme' }] });
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    assert.equal(byId.instructions.ok, false);
    assert.equal(byId.greeting.ok, false);
    assert.equal(byId.voice.ok, false);
    assert.equal(byId.knowledge.ok, false);
    assert.equal(byId.variables.ok, false);
    assert.match(byId.variables.detail, /lead_name/);
    const good = buildReadinessChecks({ ...base, promptMode: 'expert', greetingEnabled: false, speaker: 'shubh_enhi_ads', capsuleId: '3', testVariables: { lead_name: 'Asha' } }, { voiceIds: ['shubh_enhi_ads'], detectedVariables: [{ name: 'lead_name', fallback: '' }] });
    assert.ok(good.every((c) => c.ok));
});

test('blueprint fields: existing agents keep their name, test values are preserved', () => {
    const arch = {
        id: 'x', name: 'COD Confirmation', category: 'D2C & E-Commerce', defaultRole: 'outbound_qualification', mission: 'Confirm orders',
        systemPrompt: 'Hello {{customer_name | "Sir"}}', greeting: 'Hi {{customer_name}}', greetingEnabled: true, defaultVoiceId: 'priya_hi_recovery', defaultPace: 1.2,
        supportedVariables: [{ name: 'customer_name', sampleValue: 'Rahul' }],
    };
    const fresh = archetypeToEditorPartial(arch, { testVariables: {} });
    assert.equal(fresh.agentName, 'COD Confirmation');
    assert.equal(fresh.promptMode, 'custom');
    assert.equal(fresh.greetingEnabled, true);
    assert.equal(fresh.pace, 1.2);
    assert.equal(fresh.testVariables.customer_name, 'Rahul');
    const kept = archetypeToEditorPartial(arch, { testVariables: { customer_name: 'Asha' }, keepName: true });
    assert.equal('agentName' in kept, false);
    assert.equal(kept.testVariables.customer_name, 'Asha');
    const expert = archetypeToEditorPartial({ ...arch, category: 'B2B & SaaS' });
    assert.equal(expert.promptMode, 'expert');
    assert.equal(expert.systemPrompt, '');
    assert.equal(expert.greetingEnabled, false);
});

test('tool request bodies drop local ids and timestamps; voice counts come from the catalogue', () => {
    assert.deepEqual(toolRequestBody({ id: 'tool_draft_1', agent_id: 'a', name: 'x', config: {}, created_at: 'c' }), { name: 'x', config: {} });
    assert.deepEqual(languageVoiceCounts([{ language: 'Hindi' }, { language: 'Hindi' }, { language: 'Tamil' }, {}]), [{ language: 'Hindi', count: 2 }, { language: 'Tamil', count: 1 }]);
});
