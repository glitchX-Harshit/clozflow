import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:clozflow/core/auth/auth_state.dart';
import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_spacing.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';
import 'package:clozflow/widgets/stat_card.dart';
import 'package:clozflow/widgets/shimmer_loading.dart';
import 'package:clozflow/features/dashboard/providers/dashboard_provider.dart';

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
    
    final statsAsync = ref.watch(dashboardStatsProvider);
    final callsAsync = ref.watch(recentCallsProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text.rich(
          TextSpan(
            text: 'Clozflow',
            style: AppTextStyles.h3.copyWith(
              color: Colors.black,
              fontWeight: FontWeight.w900,
            ),
            children: [
              TextSpan(
                text: '.',
                style: TextStyle(
                  color: AppColors.magenta,
                ),
              ),
            ],
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
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(dashboardStatsProvider);
          ref.invalidate(recentCallsProvider);
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
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

              // Stats cards
              statsAsync.when(
                data: (data) {
                  final totalCalls = data['total_calls']?.toString() ?? '0';
                  final insightsList = data['insights'] as List<dynamic>? ?? [];
                  final insightsCount = insightsList.length.toString();
                  // We can get saved leads count from another provider or just use trajectory/modules
                  // For now let's just show what we have in stats
                  final closeVelocity = (data['stats'] as List<dynamic>?)?.firstWhere(
                    (s) => s['label'] == 'CLOSE VELOCITY', 
                    orElse: () => {'value': '0%'}
                  )['value'] ?? '0%';

                  return Container(
                    decoration: BoxDecoration(
                      border: Border.all(color: Colors.black, width: 3),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: const BoxDecoration(
                            border: Border(bottom: BorderSide(color: Colors.black, width: 3)),
                            color: Colors.black,
                          ),
                          child: Text(
                            'METRICS OVERVIEW',
                            style: AppTextStyles.subtitle1.copyWith(
                              color: Colors.white,
                              letterSpacing: 2,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        IntrinsicHeight(
                          child: Row(
                            children: [
                              Expanded(
                                child: Container(
                                  padding: const EdgeInsets.all(AppSpacing.lg),
                                  decoration: const BoxDecoration(
                                    border: Border(right: BorderSide(color: Colors.black, width: 3)),
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        totalCalls,
                                        style: AppTextStyles.h1.copyWith(
                                          fontWeight: FontWeight.w900,
                                          fontSize: 48,
                                        ),
                                      ),
                                      Text(
                                        'TOTAL CALLS',
                                        style: AppTextStyles.caption.copyWith(
                                          fontWeight: FontWeight.w700,
                                          letterSpacing: 1.5,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              Expanded(
                                child: Container(
                                  padding: const EdgeInsets.all(AppSpacing.lg),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        closeVelocity,
                                        style: AppTextStyles.h1.copyWith(
                                          fontWeight: FontWeight.w900,
                                          fontSize: 48,
                                        ),
                                      ),
                                      Text(
                                        'CLOSE VEL.',
                                        style: AppTextStyles.caption.copyWith(
                                          fontWeight: FontWeight.w700,
                                          letterSpacing: 1.5,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.lg),
                          decoration: const BoxDecoration(
                            border: Border(top: BorderSide(color: Colors.black, width: 3)),
                            color: Color(0xFFF0F0F0),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'RAW INSIGHTS EXTRACTED',
                                style: AppTextStyles.caption.copyWith(
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 1.5,
                                ),
                              ),
                              Text(
                                insightsCount,
                                style: AppTextStyles.h3.copyWith(
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
                loading: () => const DashboardShimmer(),
                error: (e, st) => Text('Failed to load: $e', style: const TextStyle(color: Colors.red)),
              ),
              
              const SizedBox(height: AppSpacing.xxxl),

              // Recent activity
              Text('Recent Calls', style: AppTextStyles.h3),
              const SizedBox(height: AppSpacing.xl),
              
              callsAsync.when(
                data: (calls) {
                  if (calls.isEmpty) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxxl),
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
                              style: AppTextStyles.subtitle2.copyWith(color: AppColors.textSecondary),
                            ),
                            const SizedBox(height: AppSpacing.xs),
                            Text(
                              'Start a call to see your activity here',
                              style: AppTextStyles.body2.copyWith(color: AppColors.textTertiary),
                            ),
                          ],
                        ),
                      ),
                    );
                  }
                  
                  return ListView.separated(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: calls.length > 5 ? 5 : calls.length,
                    separatorBuilder: (context, index) => const Divider(),
                    itemBuilder: (context, index) {
                      final call = calls[index];
                      final date = DateTime.tryParse(call['timestamp'] ?? '');
                      final dateStr = date != null ? '${date.day}/${date.month}/${date.year}' : 'Unknown';
                      
                      return ListTile(
                        leading: const CircleAvatar(
                          backgroundColor: AppColors.surface,
                          child: Icon(Icons.phone_callback_rounded, color: AppColors.navy),
                        ),
                        title: Text('Call on $dateStr', style: AppTextStyles.subtitle2),
                        subtitle: Text('${call['message_count']} messages • ${call['insight_count']} insights'),
                        trailing: const Icon(Icons.chevron_right_rounded),
                        onTap: () {
                          // Navigate to call details
                        },
                      );
                    },
                  );
                },
                loading: () => const SizedBox(height: 300, child: ListShimmer()),
                error: (e, st) => Text('Failed to load calls: $e', style: const TextStyle(color: Colors.red)),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          context.push('/live-call', extra: <String, dynamic>{
            'business_name': 'Unknown Prospect',
          });
        },
        backgroundColor: Colors.black,
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
