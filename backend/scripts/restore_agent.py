import sqlite3

def run():
    conn = sqlite3.connect('backend/hexagon.db')
    c = conn.cursor()
    agent_id = 'dadcb038afae4b0eb45987eec150403e'
    rows = c.execute('SELECT id, user_id, name FROM pearl_agents WHERE id = ?', (agent_id,)).fetchall()
    print('Found rows before:', rows)
    if not rows:
        c.execute('''
            INSERT INTO pearl_agents (
                id, user_id, name, role, status, capsule_id, mission, 
                qualification_rules, autonomy_policy, voice_config, 
                call_provider, current_state, created_at, updated_at, 
                system_prompt, greeting, test_variables, version
            ) VALUES (
                ?, 1, 'shivangi', 'outbound_qualification', 'active', 1,
                'Qualify prospect and establish fit.', '{}', '{}',
                '{"speaker": "pooja_hi_conversational", "language": "Auto", "pace": 1.0, "tone": "Friendly"}',
                'vobiz', 'idle', '2026-10-31 12:44:11', '2026-11-01 11:03:17',
                'reframe there assumptions and objection\n- Use natural Hinglish words like "bilkul", "actually", and "sahi".',
                'Hi, main ClozFlow se baat kar rahi hoon. Kaise hain aap?',
                '{"prospect_name": "Rahul Sharma", "company": "Dancing Cow"}', 1
            )
        ''', (agent_id,))
        conn.commit()
        print('Agent dadcb038afae4b0eb45987eec150403e restored successfully!')
    else:
        print('Agent already present:', rows)

if __name__ == '__main__':
    run()
