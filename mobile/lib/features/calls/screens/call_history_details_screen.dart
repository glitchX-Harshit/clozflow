import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_spacing.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';
import 'package:clozflow/features/calls/providers/calls_provider.dart';

class CallHistoryDetailsScreen extends ConsumerWidget {
  final int callId;

  const CallHistoryDetailsScreen({super.key, required this.callId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final callAsync = ref.watch(callDetailsProvider(callId));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Call Insights'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: callAsync.when(
        data: (callData) {
          final details = callData['details'] ?? {};
          final verdict = details['verdict'] ?? {};
          final strategyTimeline = details['strategyTimeline'] as List<dynamic>? ?? [];
          final objectionScore = details['objectionScore'] ?? 0;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Verdict Section
                _buildSectionHeader('AI Verdict'),
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.divider),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Close Probability', style: AppTextStyles.body1),
                          Text(
                            '${verdict['probability'] ?? 'Unknown'} (${verdict['pct'] ?? 0}%)',
                            style: AppTextStyles.subtitle1.copyWith(
                              color: _getProbabilityColor(verdict['probability']),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      const Divider(),
                      const SizedBox(height: AppSpacing.sm),
                      Text('Primary Blocker', style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                      Text(verdict['blocker'] ?? 'None', style: AppTextStyles.body1.copyWith(color: AppColors.error)),
                      const SizedBox(height: AppSpacing.sm),
                      Text('Next Move', style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                      Text(verdict['nextMove'] ?? '', style: AppTextStyles.body1),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),

                // Objection Score
                _buildSectionHeader('Friction & Objections'),
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.divider),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Objection Intensity Score', style: AppTextStyles.body2),
                            const SizedBox(height: 4),
                            LinearProgressIndicator(
                              value: objectionScore / 100,
                              color: objectionScore > 50 ? AppColors.error : AppColors.warning,
                              backgroundColor: AppColors.background,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Text('$objectionScore%', style: AppTextStyles.h2),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),

                // Strategy Timeline
                _buildSectionHeader('Strategy Timeline'),
                if (strategyTimeline.isEmpty)
                  Text('No strategies recorded.', style: AppTextStyles.body2)
                else
                  ...strategyTimeline.map((item) {
                    final isGood = item['result'] == 'good';
                    return Container(
                      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isGood ? AppColors.success : AppColors.error,
                          width: 2,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(item['turn'] ?? '', style: AppTextStyles.subtitle2),
                              Icon(
                                isGood ? Icons.check_circle : Icons.warning,
                                color: isGood ? AppColors.success : AppColors.error,
                                size: 16,
                              )
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Text(item['strategy'] ?? '', style: AppTextStyles.body1.copyWith(fontWeight: FontWeight.bold)),
                          const SizedBox(height: AppSpacing.xs),
                          Text(item['note'] ?? '', style: AppTextStyles.body2),
                        ],
                      ),
                    );
                  }),
              ],
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, st) => Center(child: Text('Error: $e')),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Text(
        title,
        style: AppTextStyles.h3.copyWith(color: AppColors.navy),
      ),
    );
  }

  Color _getProbabilityColor(String? prob) {
    if (prob == 'High') return AppColors.success;
    if (prob == 'Moderate') return AppColors.warning;
    if (prob == 'Low') return AppColors.error;
    return AppColors.textPrimary;
  }
}
