import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:clozflow/core/auth/auth_service.dart';
import 'package:clozflow/core/auth/auth_state.dart';
import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_spacing.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  String _getUserInitials(AppAuthState authState) {
    final email = authState.user?.email ?? '';
    final meta = authState.user?.userMetadata;
    final fullName = meta?['full_name'] as String? ??
        meta?['name'] as String? ??
        '';

    if (fullName.isNotEmpty) {
      final parts = fullName.trim().split(' ');
      if (parts.length >= 2) {
        return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
      }
      return fullName[0].toUpperCase();
    }
    if (email.isNotEmpty) {
      return email[0].toUpperCase();
    }
    return '?';
  }

  String _getDisplayName(AppAuthState authState) {
    final meta = authState.user?.userMetadata;
    return meta?['full_name'] as String? ??
        meta?['name'] as String? ??
        authState.user?.email?.split('@').first ??
        'User';
  }

  void _showSignOutDialog(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Sign Out', style: AppTextStyles.h3),
        content: Text(
          'Are you sure you want to sign out?',
          style: AppTextStyles.body1,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.borderRadiusLg),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(
              'Cancel',
              style: AppTextStyles.button.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(dialogContext);
              final authService = ref.read(authServiceProvider);
              await authService.signOut();
              // Router redirect handles navigation to /login
            },
            child: Text(
              'Sign Out',
              style: AppTextStyles.button.copyWith(color: AppColors.error),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authNotifierProvider);
    final initials = _getUserInitials(authState);
    final displayName = _getDisplayName(authState);
    final email = authState.user?.email ?? '';

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.screenPadding),
        children: [
          // User info header
          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.black, width: 4),
              color: Colors.white,
              boxShadow: const [
                BoxShadow(
                  color: Colors.black,
                  offset: Offset(6, 6),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  color: Colors.black,
                  alignment: Alignment.center,
                  child: Text(
                    initials,
                    style: AppTextStyles.h2.copyWith(color: Colors.white, fontWeight: FontWeight.w900),
                  ),
                ),
                const SizedBox(width: AppSpacing.lg),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(displayName.toUpperCase(), style: AppTextStyles.subtitle1.copyWith(fontWeight: FontWeight.w900, letterSpacing: 1.5)),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        email.toUpperCase(),
                        style: AppTextStyles.body2.copyWith(
                          color: Colors.black,
                          fontWeight: FontWeight.bold,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xxxl),
          Container(height: 4, color: Colors.black),
          _buildSettingsItem('PROFILE', Icons.person_outline_rounded, () {}),
          Container(height: 4, color: Colors.black),
          _buildSettingsItem('CAPSULES', Icons.inventory_2_outlined, () {}),
          Container(height: 4, color: Colors.black),
          _buildSettingsItem('ABOUT', Icons.info_outline_rounded, () {
            showAboutDialog(
              context: context,
              applicationName: 'CLOZFLOW',
              applicationVersion: '1.0.0',
              applicationLegalese: '© 2026 CLOZFLOW.',
            );
          }),
          Container(height: 4, color: Colors.black),
          _buildSettingsItem('SIGN OUT', Icons.logout_rounded, () => _showSignOutDialog(context, ref), isDestructive: true),
          Container(height: 4, color: Colors.black),
        ],
      ),
    );
  }

  Widget _buildSettingsItem(String title, IconData icon, VoidCallback onTap, {bool isDestructive = false}) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg, horizontal: AppSpacing.md),
        color: Colors.white,
        child: Row(
          children: [
            Icon(
              icon,
              color: isDestructive ? Colors.red : Colors.black,
              size: 28,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                title,
                style: AppTextStyles.subtitle1.copyWith(
                  color: isDestructive ? Colors.red : Colors.black,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 2,
                ),
              ),
            ),
            Icon(Icons.chevron_right_rounded, color: isDestructive ? Colors.red : Colors.black),
          ],
        ),
      ),
    );
  }
}
