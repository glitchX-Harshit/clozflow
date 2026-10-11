"""
Clozflow Admin Intelligence — Secure Operator Bootstrap CLI
Allows trusted system operators to promote an existing registered user to administrator.
Must be run directly on the host / server shell.
NEVER exposed via public HTTP endpoints.
"""
import argparse
import sys
import os

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database import SessionLocal
from models import User
from admin.models import AdminAuditLog
from routers.auth import get_password_hash
from datetime import datetime
from typing import Optional


def bootstrap_admin(email: str, role: str = "super_admin", password: Optional[str] = None):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email.strip().lower()).first()
        if not user:
            print(f"[ERROR] User with email '{email}' does not exist.")
            print("Please have the operator register or sign in first before granting admin privileges.")
            sys.exit(1)

        previous_role = user.admin_role or "user"
        previous_status = user.is_admin

        user.is_admin = True
        user.admin_role = role
        user.account_status = "active"

        password_updated = False
        if password:
            user.password_hash = get_password_hash(password)
            password_updated = True

        # Record audit log
        audit = AdminAuditLog(
            admin_user_id=user.id,
            admin_email="system_bootstrap_cli",
            action="operator_bootstrap_promotion",
            resource_type="user",
            resource_id=str(user.id),
            details=f"CLI operator promoted '{user.email}' from {previous_role} (is_admin={previous_status}) to {role} (is_admin=True)" + (" with password update" if password_updated else ""),
            ip_address="127.0.0.1",
            status="success",
            created_at=datetime.utcnow()
        )
        db.add(audit)
        db.commit()
        db.refresh(user)

        print("=====================================================")
        print("  CLOZFLOW ADMIN PROVISIONING SUCCESSFUL")
        print("=====================================================")
        print(f"  User ID         : {user.id}")
        print(f"  Email           : {user.email}")
        print(f"  Admin Access    : {user.is_admin}")
        print(f"  Role            : {user.admin_role}")
        print(f"  Status          : {user.account_status}")
        print(f"  Password Set    : {'YES (Updated)' if password_updated else 'Unchanged'}")
        print(f"  Audit ID        : {audit.id}")
        print("=====================================================")
        print("The administrator can now log in at /admin with these credentials.")

    except Exception as e:
        db.rollback()
        print(f"[ERROR] Failed to bootstrap administrator: {e}")
        sys.exit(1)
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Secure Clozflow Operator Admin Provisioning")
    parser.add_argument("--email", required=True, help="Email of existing user to promote")
    parser.add_argument("--role", default="super_admin", choices=["admin", "super_admin", "analyst"],
                        help="Role to assign (default: super_admin)")
    parser.add_argument("--password", help="Master password to set or reset for this admin user")
    args = parser.parse_args()

    bootstrap_admin(args.email, args.role, args.password)


if __name__ == "__main__":
    main()
