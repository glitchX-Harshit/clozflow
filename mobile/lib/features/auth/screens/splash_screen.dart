import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:clozflow/core/auth/auth_state.dart';
import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';
import 'package:clozflow/core/theme/app_spacing.dart';

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _fadeController;
  late final Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _fadeController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    _fadeAnimation = CurvedAnimation(
      parent: _fadeController,
      curve: Curves.easeIn,
    );
    _fadeController.forward();
  }

  @override
  void dispose() {
    _fadeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // The router's redirect logic handles navigation based on auth state.
    // The splash screen simply displays while auth is resolving.
    // Once authNotifierProvider transitions from initial/loading to
    // authenticated/unauthenticated, the router automatically redirects.
    ref.watch(authNotifierProvider);

    return Scaffold(
      backgroundColor: AppColors.surface,
      body: Center(
        child: FadeTransition(
          opacity: _fadeAnimation,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text.rich(
                TextSpan(
                  text: 'Clozflow',
                  style: AppTextStyles.h1.copyWith(
                    color: Colors.black,
                    fontSize: 40,
                    fontWeight: FontWeight.w800,
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
              const SizedBox(height: AppSpacing.sm),
              Text(
                'AI Sales Intelligence',
                style: AppTextStyles.body1.copyWith(
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: AppSpacing.huge),
              const SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(
                  valueColor: AlwaysStoppedAnimation<Color>(AppColors.navy),
                  strokeWidth: 2.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
