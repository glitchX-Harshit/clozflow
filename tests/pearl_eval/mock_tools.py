"""
Mocked Tools for Pearl Evaluation Harness.
Handles tool execution, latency tracking, failure injections, and state recording.
"""
import time
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

class MockToolRegistry:
    def __init__(self, failure_injection: Optional[str] = None, scenario_id: Optional[str] = None):
        self.failure_injection = failure_injection
        self.scenario_id = scenario_id
        self.tool_calls: List[Dict[str, Any]] = []
        self.apply_coupon_attempts = 0
        self.slots_state: Dict[str, Any] = {}

    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a tool with simulated latency and failure injection."""
        start_time = time.perf_counter()
        timestamp = datetime.now(timezone.utc).isoformat()

        # Handle failure injections
        if self.failure_injection == "TOOL_TIMEOUT":
            # Real sleep > 3.0s to measure real timeout latency
            await asyncio.sleep(3.1)
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            result = {
                "status": "error",
                "error": f"Tool '{tool_name}' timed out (>3.0s)",
                "tool_name": tool_name,
                "arguments": arguments,
            }
            record = {
                "tool_name": tool_name,
                "arguments": arguments,
                "result": result,
                "status": "timeout",
                "latency_ms": round(duration_ms, 2),
                "timestamp": timestamp,
            }
            self.tool_calls.append(record)
            return result

        if self.failure_injection == "TOOL_ERROR":
            await asyncio.sleep(0.1)
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            result = {
                "status": "error",
                "error": f"Internal 500: {tool_name} failed upstream",
                "tool_name": tool_name,
                "arguments": arguments,
            }
            record = {
                "tool_name": tool_name,
                "arguments": arguments,
                "result": result,
                "status": "error",
                "latency_ms": round(duration_ms, 2),
                "timestamp": timestamp,
            }
            self.tool_calls.append(record)
            return result

        if self.failure_injection == "SLOT_TAKEN" and tool_name in ("book_meeting", "check_availability", "reschedule_delivery", "schedule_callback"):
            await asyncio.sleep(0.1)
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            result = {
                "status": "error",
                "error": f"Requested slot '{arguments.get('slot') or arguments.get('datetime')}' is already taken. Please choose another time.",
                "tool_name": tool_name,
                "arguments": arguments,
            }
            record = {
                "tool_name": tool_name,
                "arguments": arguments,
                "result": result,
                "status": "slot_conflict",
                "latency_ms": round(duration_ms, 2),
                "timestamp": timestamp,
            }
            self.tool_calls.append(record)
            return result

        # Normal execution paths per tool
        await asyncio.sleep(0.05)
        
        if tool_name == "apply_coupon":
            self.apply_coupon_attempts += 1
            code = arguments.get("code", "")
            # S3 requirement: apply_coupon may fail on first try
            if self.scenario_id == "S3" and self.apply_coupon_attempts == 1:
                duration_ms = (time.perf_counter() - start_time) * 1000.0
                result = {
                    "status": "error",
                    "error": f"Coupon {code} service busy on attempt 1. Please retry.",
                    "code": code
                }
                record = {
                    "tool_name": tool_name,
                    "arguments": arguments,
                    "result": result,
                    "status": "failed_attempt_1",
                    "latency_ms": round(duration_ms, 2),
                    "timestamp": timestamp,
                }
                self.tool_calls.append(record)
                return result
            else:
                self.slots_state["coupon_applied"] = True
                result = {"status": "success", "message": f"Coupon {code} applied successfully! 10% discount added.", "discount_percent": 10}

        elif tool_name == "send_whatsapp":
            link = arguments.get("link") or arguments.get("upi_link") or arguments.get("checkout_link") or "https://clozflow.ai"
            self.slots_state["whatsapp_sent"] = True
            self.slots_state["link_sent"] = True
            result = {"status": "success", "message": f"WhatsApp message with link {link} delivered successfully"}

        elif tool_name == "schedule_callback":
            dt = arguments.get("datetime", "Tomorrow 11:00 AM")
            self.slots_state["callback_set"] = True
            self.slots_state["callback_time"] = dt
            result = {"status": "success", "message": f"Callback scheduled for {dt}"}

        elif tool_name == "mark_dnc":
            self.slots_state["dnc"] = True
            result = {"status": "success", "message": "Lead successfully added to Do Not Call registry"}

        elif tool_name == "update_order":
            landmark = arguments.get("landmark")
            window = arguments.get("delivery_window")
            self.slots_state["landmark"] = landmark
            self.slots_state["delivery_window"] = window
            self.slots_state["order_updated"] = True
            result = {"status": "success", "message": f"Order updated with landmark: {landmark}, window: {window}"}

        elif tool_name == "cancel_order":
            self.slots_state["order_cancelled"] = True
            result = {"status": "success", "message": "COD order has been cancelled per customer request"}

        elif tool_name == "check_availability":
            date_range = arguments.get("range", "this week")
            result = {"status": "success", "available_slots": ["Thursday 3:00 PM IST", "Friday 11:00 AM IST", "Friday 4:00 PM IST"]}

        elif tool_name == "book_meeting":
            slot = arguments.get("slot")
            email = arguments.get("email")
            tz = arguments.get("timezone", "IST")
            self.slots_state["meeting_booked"] = True
            self.slots_state["slot"] = slot
            self.slots_state["email"] = email
            self.slots_state["timezone"] = tz
            result = {"status": "success", "message": f"Meeting booked on {slot} ({tz}) for {email}"}

        elif tool_name == "send_email":
            deck = arguments.get("deck", "Clozflow Sales Deck")
            email = arguments.get("email")
            self.slots_state["email_sent"] = True
            result = {"status": "success", "message": f"Email with {deck} sent to {email}"}

        elif tool_name == "reschedule_delivery":
            slot = arguments.get("slot")
            landmark = arguments.get("landmark")
            address_type = arguments.get("address_type", "Home")
            self.slots_state["rescheduled"] = True
            self.slots_state["slot"] = slot
            self.slots_state["landmark"] = landmark
            self.slots_state["address_type"] = address_type
            result = {"status": "success", "message": f"Delivery rescheduled to slot {slot} at {address_type} ({landmark})"}

        elif tool_name == "raise_escalation":
            self.slots_state["escalation_raised"] = True
            result = {"status": "success", "ticket_id": "ESC-98412", "message": "Escalated to delivery hub supervisor"}

        else:
            result = {"status": "success", "message": f"Tool {tool_name} executed successfully"}

        duration_ms = (time.perf_counter() - start_time) * 1000.0
        record = {
            "tool_name": tool_name,
            "arguments": arguments,
            "result": result,
            "status": result.get("status", "success"),
            "latency_ms": round(duration_ms, 2),
            "timestamp": timestamp,
        }
        self.tool_calls.append(record)
        return result

    def get_tool_calls(self) -> List[Dict[str, Any]]:
        return list(self.tool_calls)
