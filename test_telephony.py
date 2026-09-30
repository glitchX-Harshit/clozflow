import unittest
from backend.utils.telephony import normalize_indian_phone_number, is_valid_e164

class TestTelephony(unittest.TestCase):

    def test_normalization(self):
        self.assertEqual(normalize_indian_phone_number("9876543210"), "+919876543210")
        self.assertEqual(normalize_indian_phone_number("09876543210"), "+919876543210")
        self.assertEqual(normalize_indian_phone_number("+91 98765 43210"), "+919876543210")
        self.assertEqual(normalize_indian_phone_number("919876543210"), "+919876543210")
        
        with self.assertRaises(ValueError):
            normalize_indian_phone_number("12345")
            
        with self.assertRaises(ValueError):
            normalize_indian_phone_number("abcdefghij")

    def test_e164_validation(self):
        self.assertTrue(is_valid_e164("+919876543210"))
        self.assertTrue(is_valid_e164("+14155552671"))
        self.assertFalse(is_valid_e164("9876543210"))
        self.assertFalse(is_valid_e164("+019876543210")) # Invalid country code starting with 0

if __name__ == '__main__':
    unittest.main()
