"""Meeting Wizard: the before / during / after flow of a live sales meeting.

Shared pieces live here so the REST side (brief, debrief, battlecards,
calendar) and the live side (STT, coach cards, metrics) can evolve
independently:

- ``contracts``: the JSON shapes both sides exchange.
- ``hooks``: a tiny registry so the live pipeline can hand a finished
  session to the debrief generator without importing it.
"""
