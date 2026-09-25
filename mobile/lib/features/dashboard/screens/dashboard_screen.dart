import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:clozflow/core/auth/auth_state.dart';
import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_spacing.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';
import 'package:clozflow/widgets/stat_card.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  String _getGreeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  String _getDisplayName(AppAuthState authState) {
    final meta = authState.user?.userMetadata;
    final fullName = meta?['full_name'] as String? ??
        meta?['name'] as String? ??
        '';
    if (fullName.isNotEmpty) {
      return fullName.split(' ').first;
    }
    return authState.user?.email?.split('@').first ?? 'there';
  }

  String _getUserInitials(AppAuthState authState) {
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
    final email = authState.user?.email ?? '';
    if (email.isNotEmpty) return email[0].toUpperCase();
    return '?';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authNotifierProvider);
    final greeting = _getGreeting();
    final displayName = _getDisplayName(authState);
    final initials = _getUserInitials(authState);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Clozflow',
          style: AppTextStyles.h3.copyWith(
            color: AppColors.navy,
            fontWeight: FontWeight.w700,
          ),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.lg),
            child: CircleAvatar(
              radius: 18,
              backgroundColor: AppColors.lightBlue,
              child: Text(
                initials,
                style: AppTextStyles.caption.copyWith(
                  color: AppColors.navy,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.screenPadding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Greeting
            Text(
              '$greeting, $displayName',
              style: AppTextStyles.h2,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              "Here's your sales overview",
              style: AppTextStyles.body2.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: AppSpacing.xxl),

            // Stats cards — showing placeholder values for Phase 1.
            // Phase 2 will fetch real data from /calls/stats and /leads/saved
            Row(
              children: const [
                Expanded(
                  child: StatCard(
                    title: 'Total Calls',
                    value: '—',
                    icon: Icons.phone_rounded,
                    color: AppColors.blue,
                  ),
                ),
                SizedBox(width: AppSpacing.md),
                Expanded(
                  child: StatCard(
                    title: 'Active Leads',
                    value: '—',
                    icon: Icons.people_rounded,
                    color: AppColors.success,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            const StatCard(
              title: 'Insights',
              value: '—',
              icon: Icons.lightbulb_rounded,
              color: AppColors.warning,
            ),
            const SizedBox(height: AppSpacing.xxxl),

            // Recent activity
            Text('Recent Activity', style: AppTextStyles.h3),
            const SizedBox(height: AppSpacing.xl),
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  vertical: AppSpacing.xxxl,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.history_rounded,
                      size: 56,
                      color: AppColors.textTertiary.withOpacity(0.5),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Text(
                      'No recent activity',
                      style: AppTextStyles.subtitle2.copyWith(
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      'Start a call to see your activity here',
                      style: AppTextStyles.body2.copyWith(
                        color: AppColors.textTertiary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          // Phase 2: navigate to call preparation
        },
        backgroundColor: AppColors.magenta,
        elevation: 3,
        icon: const Icon(Icons.add_rounded, color: Colors.white),
        label: Text(
          'New Call',
          style: AppTextStyles.button.copyWith(color: Colors.white),
        ),
      ),
    );
  }
}
