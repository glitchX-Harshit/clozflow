import asyncio
import os
import sys
from dotenv import load_dotenv
import httpx

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "backend")))
load_dotenv("backend/.env")

from backend.services.pearl.providers.exotel_provider import ExotelTelephonyProvider

async def main():
    provider = ExotelTelephonyProvider()
    os.environ["EXOTEL_PEARL_APP_ID"] = "123456" # Dummy app ID
    res = await provider.create_outbound_call("+919876543210", "0000000000", custom_field="123")
    print(res)

asyncio.run(main())
