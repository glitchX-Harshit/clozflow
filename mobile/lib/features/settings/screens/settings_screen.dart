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
          Row(
            children: [
              CircleAvatar(
                radius: 32,
                backgroundColor: AppColors.lightBlue,
                child: Text(
                  initials,
                  style: AppTextStyles.h2.copyWith(color: AppColors.navy),
                ),
              ),
              const SizedBox(width: AppSpacing.lg),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(displayName, style: AppTextStyles.subtitle1),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      email,
                      style: AppTextStyles.body2.copyWith(
                        color: AppColors.textSecondary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xxxl),
          const Divider(),
          ListTile(
            leading: const Icon(
              Icons.person_outline_rounded,
              color: AppColors.navy,
            ),
            title: Text('Profile', style: AppTextStyles.body1),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () {
              // Phase 2: navigate to profile editing
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(
              Icons.inventory_2_outlined,
              color: AppColors.navy,
            ),
            title: Text('Capsules', style: AppTextStyles.body1),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () {
              // Phase 2: navigate to capsules management
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(
              Icons.info_outline_rounded,
              color: AppColors.navy,
            ),
            title: Text('About', style: AppTextStyles.body1),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () {
              showAboutDialog(
                context: context,
                applicationName: 'Clozflow',
                applicationVersion: '1.0.0',
                applicationLegalese: '© 2026 Clozflow. All rights reserved.',
              );
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(
              Icons.logout_rounded,
              color: AppColors.error,
            ),
            title: Text(
              'Sign Out',
              style: AppTextStyles.body1.copyWith(color: AppColors.error),
            ),
            onTap: () => _showSignOutDialog(context, ref),
          ),
          const Divider(),
        ],
      ),
    );
  }
}
