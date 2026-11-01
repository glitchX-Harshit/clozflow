with open('backend/services/pearl/conversation_engine.py', 'r', encoding='utf-8') as f:
    content = f.read()

target = """        client = _get_llm_client()
        try:
            async with client.stream("POST", url, json=data, headers=headers) as response:
                if response.status_code != 200:
                    await response.aread()
                    print(f"[Pearl LLM] HTTP error: {response.status_code} - {response.text}")
                    yield "I apologize, let me get back to you on that."
                    return
                    
                async for chunk in response.aiter_text():
                    for line in chunk.split("\\n"):
                        if line.startswith("data: ") and line != "data: [DONE]":
                            try:
                                payload = json.loads(line[6:])
                                delta = payload["choices"][0]["delta"].get("content", "")
                                if delta:
                                    yield delta
                            except (json.JSONDecodeError, KeyError, IndexError):
                                pass
        except Exception as e:
            print(f"[Pearl LLM] Error: {e}")
            yield "I apologize, let me get back to you on that." """

replacement = """        client = _get_llm_client()
        for attempt in range(4):
            try:
                async with client.stream("POST", url, json=data, headers=headers) as response:
                    if response.status_code == 429:
                        await response.aread()
                        wait_sec = 2.5 * (attempt + 1)
                        print(f"[Pearl LLM] Rate limited (429). Retrying in {wait_sec}s (attempt {attempt+1}/4)...")
                        await asyncio.sleep(wait_sec)
                        continue

                    if response.status_code != 200:
                        await response.aread()
                        print(f"[Pearl LLM] HTTP error: {response.status_code} - {response.text}")
                        yield "I apologize, let me get back to you on that."
                        return
                        
                    async for chunk in response.aiter_text():
                        for line in chunk.split("\\n"):
                            if line.startswith("data: ") and line != "data: [DONE]":
                                try:
                                    payload = json.loads(line[6:])
                                    delta = payload["choices"][0]["delta"].get("content", "")
                                    if delta:
                                        yield delta
                                except (json.JSONDecodeError, KeyError, IndexError):
                                    pass
                    return
            except Exception as e:
                print(f"[Pearl LLM] Error: {e}")
                if attempt >= 3:
                    yield "I apologize, let me get back to you on that."
                    return
                await asyncio.sleep(1.5)"""

# normalize line endings for replacement
norm_content = content.replace("\r\n", "\n")
norm_target = target.strip().replace("\r\n", "\n")
norm_replacement = replacement.strip().replace("\r\n", "\n")

if norm_target in norm_content:
    norm_content = norm_content.replace(norm_target, norm_replacement, 1)
    with open('backend/services/pearl/conversation_engine.py', 'w', encoding='utf-8', newline='\r\n') as f:
        f.write(norm_content.replace("\n", "\r\n"))
    print("Successfully patched conversation_engine.py!")
else:
    print("Target block not found in normalized content!")
