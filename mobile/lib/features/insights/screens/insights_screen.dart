import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_spacing.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';
import 'package:clozflow/features/insights/providers/insights_provider.dart';
import 'package:clozflow/widgets/shimmer_loading.dart';

class InsightsScreen extends ConsumerWidget {
  const InsightsScreen({super.key});

  Future<void> _launchWebUrl() async {
    final url = Uri.parse('https://clozflow.in');
    if (!await launchUrl(url)) {
      debugPrint('Could not launch $url');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final capsulesAsync = ref.watch(capsulesProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Knowledge Capsules'),
        actions: [
          IconButton(
            icon: const Icon(Icons.open_in_browser),
            tooltip: 'Manage on Web',
            onPressed: _launchWebUrl,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(capsulesProvider),
        child: capsulesAsync.when(
          data: (capsules) {
            if (capsules.isEmpty) {
              return _buildEmptyState();
            }
            return ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: capsules.length,
              separatorBuilder: (context, index) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, index) {
                final capsule = capsules[index];
                return _CapsuleCard(capsule: capsule);
              },
            );
          },
          loading: () => const ListShimmer(),
          error: (e, st) => Center(child: Text('ERROR: $e', style: AppTextStyles.subtitle1.copyWith(color: Colors.red, fontWeight: FontWeight.w900))),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _launchWebUrl,
        icon: const Icon(Icons.cloud_upload, color: Colors.white),
        label: Text('Upload on Web', style: AppTextStyles.button.copyWith(color: Colors.white)),
        backgroundColor: Colors.black,
      ),
    );
  }

  Widget _buildEmptyState() {
    return ListView(
      children: [
        const SizedBox(height: 100),
        Center(
          child: Container(
            margin: const EdgeInsets.all(AppSpacing.xl),
            padding: const EdgeInsets.all(AppSpacing.xl),
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
            child: Column(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.inventory_2_outlined, size: 64, color: Colors.black),
                const SizedBox(height: AppSpacing.md),
                Text('NO CAPSULES', style: AppTextStyles.h3.copyWith(fontWeight: FontWeight.w900, letterSpacing: 2)),
                const SizedBox(height: AppSpacing.md),
                Container(height: 4, width: 40, color: Colors.black),
                const SizedBox(height: AppSpacing.md),
                Text(
                  'UPLOAD KNOWLEDGE ON THE WEB APP TO GUIDE YOUR AI.',
                  textAlign: TextAlign.center,
                  style: AppTextStyles.body2.copyWith(color: Colors.black, fontWeight: FontWeight.bold, letterSpacing: 1.5),
                ),
              ],
            ),
          ),
        )
      ],
    );
  }
}

class _CapsuleCard extends StatelessWidget {
  final dynamic capsule;

  const _CapsuleCard({required this.capsule});

  @override
  Widget build(BuildContext context) {
    final isDefault = capsule['is_default'] ?? false;
    final name = capsule['name'] ?? 'Unnamed Capsule';
    final productName = capsule['product_name'] ?? '';
    final productPrice = capsule['product_price'] ?? 'No pricing info';
    
    return InkWell(
      onTap: () {
        _showCapsuleDetails(context, capsule);
      },
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(
            color: Colors.black,
            width: 3,
          ),
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
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(name.toUpperCase(), style: AppTextStyles.subtitle1.copyWith(color: Colors.white, fontWeight: FontWeight.w900, letterSpacing: 1.5)),
                  ),
                  if (isDefault)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        border: Border.all(color: Colors.black, width: 2),
                      ),
                      child: Text('ACTIVE AI', style: AppTextStyles.caption.copyWith(color: Colors.black, fontWeight: FontWeight.w900, letterSpacing: 1.2)),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.inventory_2, size: 16, color: Colors.black),
                      const SizedBox(width: 4),
                      Text(productName.toUpperCase(), style: AppTextStyles.body2.copyWith(color: Colors.black, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.attach_money, size: 16, color: Colors.black),
                      const SizedBox(width: 4),
                      Text(productPrice.toUpperCase(), style: AppTextStyles.body2.copyWith(color: Colors.black, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showCapsuleDetails(BuildContext context, dynamic capsule) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.7,
          maxChildSize: 0.9,
          minChildSize: 0.5,
          builder: (context, scrollController) {
            return ListView(
              controller: scrollController,
              padding: const EdgeInsets.all(AppSpacing.screenPadding),
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.divider,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(capsule['name'] ?? 'Capsule Details', style: AppTextStyles.h2),
                if (capsule['is_default'] == true)
                  Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.sm),
                    child: Text('This context is actively being fed to your AI Copilot.', style: AppTextStyles.caption.copyWith(color: AppColors.magenta)),
                  ),
                const SizedBox(height: AppSpacing.xl),
                _buildDetailSection('Product', capsule['product_name']),
                _buildDetailSection('Pricing', capsule['product_price']),
                _buildDetailSection('Target Audience', capsule['target_audience']),
                _buildDetailSection('Pain Points Solved', capsule['pain_points_solved']),
                _buildDetailSection('Key Differentiators', capsule['key_differentiators']),
                _buildDetailSection('Specifications', capsule['product_specification']),
                const SizedBox(height: AppSpacing.xxxl),
              ],
            );
          },
        );
      },
    );
  }

  Widget _buildDetailSection(String title, String? content) {
    if (content == null || content.isEmpty) return const SizedBox.shrink();
    
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            color: Colors.black,
            child: Text(title.toUpperCase(), style: AppTextStyles.h3.copyWith(color: Colors.white, fontWeight: FontWeight.w900, letterSpacing: 1.2)),
          ),
          const SizedBox(height: AppSpacing.sm),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.black, width: 3),
              color: Colors.white,
            ),
            child: Text(content, style: AppTextStyles.body1.copyWith(fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}
