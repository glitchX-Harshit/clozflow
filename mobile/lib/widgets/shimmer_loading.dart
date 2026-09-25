import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';
import 'package:clozflow/core/theme/app_colors.dart';

class ShimmerLoading extends StatelessWidget {
  final double width;
  final double height;
  final double borderRadius;

  const ShimmerLoading({
    super.key,
    required this.width,
    required this.height,
    this.borderRadius = 8.0,
  });

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: AppColors.shimmerBase,
      highlightColor: AppColors.shimmerHighlight,
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(borderRadius),
        ),
      ),
    );
  }
}

class DashboardShimmer extends StatelessWidget {
  const DashboardShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Expanded(child: ShimmerLoading(width: double.infinity, height: 120, borderRadius: 16)),
              SizedBox(width: 16),
              Expanded(child: ShimmerLoading(width: double.infinity, height: 120, borderRadius: 16)),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: const [
              Expanded(child: ShimmerLoading(width: double.infinity, height: 120, borderRadius: 16)),
              SizedBox(width: 16),
              Expanded(child: ShimmerLoading(width: double.infinity, height: 120, borderRadius: 16)),
            ],
          ),
          const SizedBox(height: 32),
          const ShimmerLoading(width: 150, height: 24, borderRadius: 4),
          const SizedBox(height: 16),
          const ShimmerLoading(width: double.infinity, height: 80, borderRadius: 12),
          const SizedBox(height: 12),
          const ShimmerLoading(width: double.infinity, height: 80, borderRadius: 12),
          const SizedBox(height: 12),
          const ShimmerLoading(width: double.infinity, height: 80, borderRadius: 12),
        ],
      ),
    );
  }
}

class ListShimmer extends StatelessWidget {
  const ListShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(16.0),
      itemCount: 6,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, __) => const ShimmerLoading(width: double.infinity, height: 90, borderRadius: 12),
    );
  }
}
