import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_spacing.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';

class LeadDetailsScreen extends ConsumerWidget {
  final dynamic lead;

  const LeadDetailsScreen({super.key, required this.lead});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final businessName = lead['business_name'] ?? 'Unknown Business';
    final city = lead['city'] ?? 'Unknown City';
    final category = lead['category'] ?? 'Category';
    final aiSummary = lead['ai_summary'] ?? 'No summary available.';
    final painPoint = lead['likely_pain_point'] ?? 'None identified';
    final outreachAngle = lead['outreach_angle'] ?? 'Standard approach';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Call Preparation'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.screenPadding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Text(businessName, style: AppTextStyles.h2),
            const SizedBox(height: AppSpacing.xs),
            Row(
              children: [
                Icon(Icons.location_on, size: 16, color: AppColors.textSecondary),
                const SizedBox(width: 4),
                Text(city, style: AppTextStyles.body1.copyWith(color: AppColors.textSecondary)),
                const SizedBox(width: 16),
                Icon(Icons.category, size: 16, color: AppColors.textSecondary),
                const SizedBox(width: 4),
                Text(category, style: AppTextStyles.body1.copyWith(color: AppColors.textSecondary)),
              ],
            ),
            const SizedBox(height: AppSpacing.xxxl),

            // AI Context
            _buildSection(
              title: 'Business Context',
              icon: Icons.business,
              content: aiSummary,
            ),
            const SizedBox(height: AppSpacing.xl),

            _buildSection(
              title: 'Known Concerns & Pain Points',
              icon: Icons.warning_amber_rounded,
              content: painPoint,
              contentColor: AppColors.error,
            ),
            const SizedBox(height: AppSpacing.xl),

            _buildSection(
              title: 'Suggested Preparation & Angle',
              icon: Icons.lightbulb_outline,
              content: outreachAngle,
              contentColor: AppColors.navy,
            ),
            const SizedBox(height: AppSpacing.huge),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.success,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            icon: const Icon(Icons.phone),
            label: const Text('Initiate Call', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            onPressed: () {
              context.push('/live-call', extra: lead);
            },
          ),
        ),
      ),
    );
  }

  Widget _buildSection({
    required String title,
    required IconData icon,
    required String content,
    Color contentColor = AppColors.textPrimary,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 20, color: AppColors.navy),
            const SizedBox(width: 8),
            Text(title, style: AppTextStyles.h3),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.divider),
          ),
          child: Text(
            content,
            style: AppTextStyles.body1.copyWith(color: contentColor),
          ),
        ),
      ],
    );
  }
}
