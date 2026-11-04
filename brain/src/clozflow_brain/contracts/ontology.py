"""Core Cognitive Ontology primitives per CCBS Volume III."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class PrimitiveOntologicalType(StrEnum):
    ENTITY = "ENTITY"
    ATTRIBUTE = "ATTRIBUTE"
    RELATIONSHIP = "RELATIONSHIP"
    STATE = "STATE"
    EVENT = "EVENT"
    CONSTRAINT = "CONSTRAINT"
    EVIDENCE = "EVIDENCE"


class OntologicalPrimitive(BaseModel):
    """Base class for all cognitive primitives."""

    model_config = ConfigDict(extra="forbid")
    
    @classmethod
    def get_ontological_type(cls) -> PrimitiveOntologicalType:
        raise NotImplementedError("Must be implemented by primitive subclass")


class EntityPrimitive(OntologicalPrimitive):
    """Represents a discrete object or concept."""

    @classmethod
    def get_ontological_type(cls) -> PrimitiveOntologicalType:
        return PrimitiveOntologicalType.ENTITY


class AttributePrimitive(OntologicalPrimitive):
    """Represents a property of an entity."""

    @classmethod
    def get_ontological_type(cls) -> PrimitiveOntologicalType:
        return PrimitiveOntologicalType.ATTRIBUTE


class RelationshipPrimitive(OntologicalPrimitive):
    """Represents a connection between entities."""

    @classmethod
    def get_ontological_type(cls) -> PrimitiveOntologicalType:
        return PrimitiveOntologicalType.RELATIONSHIP


class StatePrimitive(OntologicalPrimitive):
    """Represents a condition of an entity at a given time."""

    @classmethod
    def get_ontological_type(cls) -> PrimitiveOntologicalType:
        return PrimitiveOntologicalType.STATE


class EventPrimitive(OntologicalPrimitive):
    """Represents something that happened at a specific time."""

    @classmethod
    def get_ontological_type(cls) -> PrimitiveOntologicalType:
        return PrimitiveOntologicalType.EVENT


class ConstraintPrimitive(OntologicalPrimitive):
    """Represents a restriction or rule."""

    @classmethod
    def get_ontological_type(cls) -> PrimitiveOntologicalType:
        return PrimitiveOntologicalType.CONSTRAINT


class EvidencePrimitive(OntologicalPrimitive):
    """Represents data supporting a belief or state."""

    @classmethod
    def get_ontological_type(cls) -> PrimitiveOntologicalType:
        return PrimitiveOntologicalType.EVIDENCE
