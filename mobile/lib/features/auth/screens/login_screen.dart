import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;

import 'package:clozflow/core/auth/auth_service.dart';
import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_spacing.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';
import 'package:clozflow/widgets/clozflow_button.dart';
import 'package:clozflow/widgets/clozflow_text_field.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  bool _isLoading = false;
  bool _isGoogleLoading = false;
  bool _isGithubLoading = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleEmailLogin() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    try {
      final authService = ref.read(authServiceProvider);
      await authService.signInWithEmail(
        _emailController.text.trim(),
        _passwordController.text,
      );
      // Auth state listener in AuthNotifier handles navigation via router redirect
    } on AuthException catch (e) {
      if (mounted) {
        _showError(e.message);
      }
    } catch (e) {
      if (mounted) {
        _showError('An unexpected error occurred. Please try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _handleGoogleLogin() async {
    setState(() => _isGoogleLoading = true);
    try {
      final authService = ref.read(authServiceProvider);
      await authService.signInWithGoogle();
    } catch (e) {
      if (mounted) {
        _showError('Google sign-in failed. Please try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _isGoogleLoading = false);
      }
    }
  }

  Future<void> _handleGithubLogin() async {
    setState(() => _isGithubLoading = true);
    try {
      final authService = ref.read(authServiceProvider);
      await authService.signInWithGithub();
    } catch (e) {
      if (mounted) {
        _showError('GitHub sign-in failed. Please try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _isGithubLoading = false);
      }
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: AppColors.error,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.borderRadius),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => FocusScope.of(context).unfocus(),
      child: Scaffold(
        backgroundColor: AppColors.surface,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.screenPadding),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Brand
                    Text.rich(
                      TextSpan(
                        text: 'Clozflow',
                        style: AppTextStyles.h1.copyWith(
                          color: Colors.black,
                          fontSize: 36,
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
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AppSpacing.huge),

                    // Heading
                    Text(
                      'Welcome back',
                      style: AppTextStyles.h2,
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      'Sign in to continue to your dashboard',
                      style: AppTextStyles.body2.copyWith(
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xxxl),

                    // Email field
                    ClozflowTextField(
                      controller: _emailController,
                      label: 'Email',
                      hint: 'Enter your email',
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      prefixIcon: const Icon(Icons.email_outlined, size: 20),
                      validator: (value) {
                        if (value == null || value.trim().isEmpty) {
                          return 'Please enter your email';
                        }
                        if (!RegExp(r'^[^@]+@[^@]+\.[^@]+').hasMatch(value.trim())) {
                          return 'Please enter a valid email';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // Password field
                    ClozflowTextField(
                      controller: _passwordController,
                      label: 'Password',
                      hint: 'Enter your password',
                      obscureText: _obscurePassword,
                      textInputAction: TextInputAction.done,
                      prefixIcon: const Icon(Icons.lock_outlined, size: 20),
                      suffixIcon: IconButton(
                        icon: Icon(
                          _obscurePassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                          color: AppColors.textTertiary,
                          size: 20,
                        ),
                        onPressed: () {
                          setState(() => _obscurePassword = !_obscurePassword);
                        },
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return 'Please enter your password';
                        }
                        if (value.length < 6) {
                          return 'Password must be at least 6 characters';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpacing.xxxl),

                    // Sign in button
                    ClozflowButton(
                      label: 'Sign In',
                      isLoading: _isLoading,
                      onPressed: _handleEmailLogin,
                    ),
                    const SizedBox(height: AppSpacing.xxl),

                    // Divider
                    Row(
                      children: [
                        const Expanded(child: Divider()),
                        Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.md,
                          ),
                          child: Text(
                            'Or continue with',
                            style: AppTextStyles.caption,
                          ),
                        ),
                        const Expanded(child: Divider()),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.xxl),

                    // Google sign in
                    ClozflowButton(
                      label: 'Google',
                      isOutlined: true,
                      isLoading: _isGoogleLoading,
                      icon: Icons.g_mobiledata,
                      onPressed: _handleGoogleLogin,
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // GitHub sign in
                    ClozflowButton(
                      label: 'GitHub',
                      isOutlined: true,
                      isLoading: _isGithubLoading,
                      icon: Icons.code,
                      onPressed: _handleGithubLogin,
                    ),
                    const SizedBox(height: AppSpacing.xxl),

                    // Sign up link
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          "Don't have an account?",
                          style: AppTextStyles.body2.copyWith(
                            color: AppColors.textSecondary,
                          ),
                        ),
                        TextButton(
                          onPressed: () => context.go('/signup'),
                          child: Text(
                            'Sign Up',
                            style: AppTextStyles.body2.copyWith(
                              color: AppColors.navy,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
