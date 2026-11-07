"""
Mocked Tools and World State Tracker for Pearl Evaluation Harness.
Handles tool execution, latency tracking, failure injections, and world-state diff recording:
- Calendar events (count, IST time, email)
- Orders (items, amounts, status, landmark, slots)
- WhatsApp log (recipient, link/content, timestamp)
- DNC list (Do Not Call entries)
"""
import copy
import time
import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

@dataclass
class WorldState:
    calendar_events: List[Dict[str, Any]] = field(default_factory=list)
    orders: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    whatsapp_log: List[Dict[str, Any]] = field(default_factory=list)
    dnc_list: List[str] = field(default_factory=list)

class MockToolRegistry:
    def __init__(self, failure_injection: Optional[str] = None, scenario_id: Optional[str] = None, prospect_phone: str = "+919876543210"):
        self.failure_injection = failure_injection
        self.scenario_id = scenario_id
        self.prospect_phone = prospect_phone
        self.tool_calls: List[Dict[str, Any]] = []
        self.apply_coupon_attempts = 0
        self.slots_state: Dict[str, Any] = {}
        
        # Initialize initial world state
        self.world_state = WorldState()
        self._init_scenario_world_state()
        self.initial_snapshot = copy.deepcopy(self.world_state)

    def _init_scenario_world_state(self):
        """Set up initial realistic world state before call begins."""
        sc = self.scenario_id
        if sc == "S2":
            self.world_state.orders["ORD-SNITCH-1899"] = {
                "order_id": "ORD-SNITCH-1899",
                "item": "Oversized Linen Shirt",
                "amount": 1899,
                "payment_mode": "COD",
                "status": "pending_verification",
                "landmark": None,
                "delivery_window": None,
            }
        elif sc == "S3":
            self.world_state.orders["CART-STYLE-14499"] = {
                "cart_id": "CART-STYLE-14499",
                "items": "Italian Leather Jacket + Boots",
                "amount": 14499,
                "status": "abandoned",
                "coupon": None,
                "discount_percent": 0,
            }
        elif sc == "S5":
            self.world_state.orders["AWB-DEL-9841203"] = {
                "awb": "DEL-9841203",
                "carrier": "Delhivery",
                "status": "delivery_failed_reattempt_needed",
                "slot": None,
                "landmark": None,
                "address_type": None,
                "alternate_phone": None,
            }

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
            await asyncio.sleep(0.08)
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
            await asyncio.sleep(0.08)
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            requested_slot = arguments.get("slot") or arguments.get("datetime") or "requested time"
            result = {
                "status": "error",
                "error": f"Requested slot '{requested_slot}' is already booked. Available alternative: Friday 11:00 AM IST.",
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
                if "CART-STYLE-14499" in self.world_state.orders:
                    self.world_state.orders["CART-STYLE-14499"]["coupon"] = code
                    self.world_state.orders["CART-STYLE-14499"]["discount_percent"] = 10
                    self.world_state.orders["CART-STYLE-14499"]["status"] = "coupon_applied"
                result = {"status": "success", "message": f"Coupon {code} applied successfully! 10% discount added.", "discount_percent": 10}

        elif tool_name == "send_whatsapp":
            link = arguments.get("link") or arguments.get("upi_link") or arguments.get("checkout_link") or "https://clozflow.ai"
            self.slots_state["whatsapp_sent"] = True
            self.slots_state["link_sent"] = True
            self.world_state.whatsapp_log.append({
                "recipient": self.prospect_phone,
                "link": link,
                "timestamp": timestamp,
                "status": "delivered",
            })
            result = {"status": "success", "message": f"WhatsApp message with link {link} delivered successfully"}

        elif tool_name == "schedule_callback":
            dt = arguments.get("datetime", "Tomorrow 11:00 AM")
            self.slots_state["callback_set"] = True
            self.slots_state["callback_time"] = dt
            self.world_state.calendar_events.append({
                "title": f"Callback with {self.prospect_phone}",
                "time_ist": dt,
                "email": arguments.get("email", "prospect@phone.call"),
                "type": "callback",
                "timestamp": timestamp,
            })
            result = {"status": "success", "message": f"Callback scheduled for {dt}"}

        elif tool_name == "mark_dnc":
            self.slots_state["dnc"] = True
            if self.prospect_phone not in self.world_state.dnc_list:
                self.world_state.dnc_list.append(self.prospect_phone)
            result = {"status": "success", "message": f"Lead {self.prospect_phone} successfully added to Do Not Call registry"}

        elif tool_name == "update_order":
            landmark = arguments.get("landmark")
            window = arguments.get("delivery_window")
            self.slots_state["landmark"] = landmark
            self.slots_state["delivery_window"] = window
            self.slots_state["order_updated"] = True
            if "ORD-SNITCH-1899" in self.world_state.orders:
                self.world_state.orders["ORD-SNITCH-1899"]["landmark"] = landmark
                self.world_state.orders["ORD-SNITCH-1899"]["delivery_window"] = window
                self.world_state.orders["ORD-SNITCH-1899"]["status"] = "confirmed"
            result = {"status": "success", "message": f"Order updated with landmark: {landmark}, window: {window}"}

        elif tool_name == "cancel_order":
            self.slots_state["order_cancelled"] = True
            if "ORD-SNITCH-1899" in self.world_state.orders:
                self.world_state.orders["ORD-SNITCH-1899"]["status"] = "cancelled"
            result = {"status": "success", "message": "COD order has been cancelled per customer request"}

        elif tool_name == "check_availability":
            result = {"status": "success", "available_slots": ["Thursday 3:00 PM IST", "Friday 11:00 AM IST", "Friday 4:00 PM IST"]}

        elif tool_name == "book_meeting":
            slot = arguments.get("slot", "Thursday 3:00 PM IST")
            email = arguments.get("email", "siddharth.roy@zetalogistics.in")
            tz = arguments.get("timezone", "IST")
            self.slots_state["meeting_booked"] = True
            self.slots_state["slot"] = slot
            self.slots_state["email"] = email
            self.slots_state["timezone"] = tz
            self.world_state.calendar_events.append({
                "title": "Clozflow AI Voice Agent Demo",
                "time_ist": slot,
                "email": email,
                "timezone": tz,
                "timestamp": timestamp,
            })
            result = {"status": "success", "message": f"Meeting booked on {slot} ({tz}) for {email}"}

        elif tool_name == "send_email":
            deck = arguments.get("deck", "Clozflow Sales Deck")
            email = arguments.get("email", "siddharth.roy@zetalogistics.in")
            self.slots_state["email_sent"] = True
            result = {"status": "success", "message": f"Email with {deck} sent to {email}"}

        elif tool_name == "reschedule_delivery":
            slot = arguments.get("slot")
            landmark = arguments.get("landmark")
            address_type = arguments.get("address_type", "Home")
            alt_phone = arguments.get("alternate_phone", self.prospect_phone)
            self.slots_state["rescheduled"] = True
            self.slots_state["slot"] = slot
            self.slots_state["landmark"] = landmark
            self.slots_state["address_type"] = address_type
            self.slots_state["alternate_phone"] = alt_phone
            if "AWB-DEL-9841203" in self.world_state.orders:
                self.world_state.orders["AWB-DEL-9841203"]["slot"] = slot
                self.world_state.orders["AWB-DEL-9841203"]["landmark"] = landmark
                self.world_state.orders["AWB-DEL-9841203"]["address_type"] = address_type
                self.world_state.orders["AWB-DEL-9841203"]["alternate_phone"] = alt_phone
                self.world_state.orders["AWB-DEL-9841203"]["status"] = "rescheduled"
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

    def get_world_state_diff(self) -> Dict[str, Any]:
        """Calculates exact before/after delta in world state for this call."""
        added_calendar = [
            e for e in self.world_state.calendar_events
            if e not in self.initial_snapshot.calendar_events
        ]
        modified_orders = {
            k: v for k, v in self.world_state.orders.items()
            if self.initial_snapshot.orders.get(k) != v
        }
        added_whatsapp = [
            w for w in self.world_state.whatsapp_log
            if w not in self.initial_snapshot.whatsapp_log
        ]
        added_dnc = [
            d for d in self.world_state.dnc_list
            if d not in self.initial_snapshot.dnc_list
        ]
        return {
            "calendar_events_count": len(added_calendar),
            "calendar_events": added_calendar,
            "orders_modified_count": len(modified_orders),
            "orders": modified_orders,
            "whatsapp_messages_sent": len(added_whatsapp),
            "whatsapp_log": added_whatsapp,
            "dnc_added": added_dnc,
            "is_dnc": len(added_dnc) > 0,
        }

    def get_tool_calls(self) -> List[Dict[str, Any]]:
        return list(self.tool_calls)
