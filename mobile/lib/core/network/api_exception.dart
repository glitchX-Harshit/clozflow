import 'package:dio/dio.dart';

class ApiException implements Exception {
  final int? statusCode;
  final String message;
  final dynamic data;

  ApiException({
    this.statusCode,
    required this.message,
    this.data,
  });

  bool get isUnauthorized => statusCode == 401 || statusCode == 403;

  factory ApiException.fromDioException(DioException exception) {
    switch (exception.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return ApiException.timeout();
      case DioExceptionType.badResponse:
        return ApiException.fromResponse(exception.response);
      case DioExceptionType.cancel:
        return ApiException(message: 'Request was cancelled');
      case DioExceptionType.connectionError:
        return ApiException.network();
      case DioExceptionType.badCertificate:
        return ApiException(message: 'Bad certificate');
      case DioExceptionType.unknown:
      default:
        return ApiException.unknown(exception.error?.toString());
    }
  }

  factory ApiException.fromResponse(Response<dynamic>? response) {
    if (response == null) return ApiException.unknown();

    final statusCode = response.statusCode;
    if (statusCode == 401) {
      return ApiException.unauthorized();
    }

    String msg = 'An error occurred';
    dynamic responseData;

    try {
      if (response.data is Map<String, dynamic>) {
        responseData = response.data;
        msg = responseData['message'] ?? responseData['error'] ?? 'Server error';
      } else if (response.data is String) {
        msg = response.data;
      }
    } catch (_) {}

    return ApiException(
      statusCode: statusCode,
      message: msg,
      data: responseData,
    );
  }

  factory ApiException.timeout() {
    return ApiException(
      message: 'Connection timed out. Please check your internet connection.',
    );
  }

  factory ApiException.network() {
    return ApiException(
      message: 'Network error. Please check your internet connection.',
    );
  }

  factory ApiException.unauthorized() {
    return ApiException(
      statusCode: 401,
      message: 'Unauthorized. Please login again.',
    );
  }

  factory ApiException.unknown([String? details]) {
    return ApiException(
      message: details ?? 'An unknown error occurred.',
    );
  }

  @override
  String toString() {
    return 'ApiException: $message (Status: $statusCode)';
  }
}
