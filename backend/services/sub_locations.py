def get_sub_locations(city: str) -> list[str]:
    """Return neighborhood/area names for a given city."""
    city = city.lower().strip()
    
    # Handle variations
    if city in ["bengaluru"]:
        city = "bangalore"
    elif city in ["gurugram"]:
        city = "gurgaon"
        
    locations = {
        "mumbai": [
            "Andheri East", "Andheri West", "Bandra West", "Bandra East", "Borivali West", "Borivali East",
            "Dadar West", "Dadar East", "Ghatkopar West", "Ghatkopar East", "Kurla West", "Kurla East",
            "Powai", "Vashi", "Thane West", "Thane East", "Navi Mumbai", "Worli", "Lower Parel",
            "Malad West", "Malad East", "Goregaon West", "Goregaon East", "Kandivali West", "Kandivali East",
            "Jogeshwari West", "Jogeshwari East", "Santacruz West", "Santacruz East", "Vile Parle West",
            "Vile Parle East", "Chembur", "Mulund West", "Mulund East", "Vikhroli", "Bhandup", "Wadala",
            "Parel", "Matunga", "Sion", "Mahim", "Khar West", "Khar East", "Juhu", "Versova", "Lokhandwala",
            "Colaba", "Fort", "Churchgate", "Marine Lines", "Grant Road", "Byculla", "Mazgaon", "Sewri",
            "Dharavi", "Mira Road", "Bhayander", "Vasai", "Virar", "Panvel", "Kharghar", "Belapur",
            "Airoli", "Ghansoli", "Kopar Khairane", "Nerul", "Sanpada", "Turbhe", "Dombivli", "Kalyan",
            "Ambernath", "Badlapur", "Ulhasnagar"
        ],
        "delhi": [
            "Connaught Place", "Karol Bagh", "Chandni Chowk", "Saket", "Hauz Khas", "Lajpat Nagar",
            "Rajouri Garden", "Dwarka", "Rohini", "Pitampura", "Model Town", "Vasant Kunj", "Vasant Vihar",
            "Defence Colony", "Greater Kailash I", "Greater Kailash II", "Nehru Place", "Janakpuri",
            "Vikaspuri", "Paschim Vihar", "Patel Nagar", "Preet Vihar", "Mayur Vihar", "Noida", "Gurgaon",
            "Faridabad", "Ghaziabad", "Indirapuram", "Vaishali", "Kaushambi", "Laxmi Nagar", "Shahdara",
            "Dilshad Garden", "Seelampur", "Uttam Nagar", "Nawada", "Najafgarh", "Mehrauli", "Chhatarpur",
            "Sarojini Nagar", "South Extension", "Green Park", "Safdarjung", "Jor Bagh", "Khan Market",
            "Lodhi Colony", "INA", "RK Puram", "Munirka", "Malviya Nagar", "Kalkaji", "Govindpuri",
            "Okhla", "Jasola", "Sarita Vihar"
        ],
        "bangalore": [
            "Indiranagar", "Koramangala", "HSR Layout", "Whitefield", "Jayanagar", "MG Road",
            "Marathahalli", "Electronic City", "JP Nagar", "Malleshwaram", "Rajajinagar", "Basavanagudi",
            "BTM Layout", "Bellandur", "Sarjapur Road", "Yelahanka", "Hebbal", "RT Nagar", "Banashankari",
            "Vijayanagar", "Nagarbhavi", "Kengeri", "Rajarajeshwari Nagar", "Bannerghatta Road", "Begur",
            "Bommanahalli", "Kudlu Gate", "Mahadevapura", "KR Puram", "Old Airport Road", "CV Raman Nagar",
            "HAL", "Domlur", "Ulsoor", "Richmond Town", "Lavelle Road", "Brigade Road", "Commercial Street",
            "Shivajinagar", "Frazer Town"
        ],
        "hyderabad": [
            "Banjara Hills", "Jubilee Hills", "Gachibowli", "Hitech City", "Madhapur", "Kukatpally",
            "Ameerpet", "Secunderabad", "Kondapur", "Begumpet", "Somajiguda", "Abids", "Nampally",
            "Charminar", "Dilsukhnagar", "LB Nagar", "Uppal", "Habsiguda", "Tarnaka", "Malkajgiri",
            "Kompally", "Miyapur", "Chandanagar", "Manikonda", "Narsingi", "Tolichowki", "Mehdipatnam",
            "Attapur", "Rajendranagar", "Shamshabad", "Nagole"
        ],
        "chennai": [
            "T. Nagar", "Adyar", "Anna Nagar", "Velachery", "Nungambakkam", "Besant Nagar", "Mylapore",
            "Porur", "Sholinganallur", "Tambaram", "Chromepet", "Pallavaram", "Guindy", "Egmore",
            "Kilpauk", "Kodambakkam", "Ashok Nagar", "Vadapalani", "KK Nagar", "Thiruvanmiyur", "ECR",
            "OMR", "Perungudi", "Taramani", "Medavakkam", "Madipakkam", "Perambur", "Kolathur",
            "Villivakkam", "Ambattur", "Avadi", "Poonamallee"
        ],
        "pune": [
            "Koregaon Park", "Viman Nagar", "Hinjewadi", "Kothrud", "Baner", "Aundh", "Shivaji Nagar",
            "Wakad", "Hadapsar", "Magarpatta", "Kalyani Nagar", "Yerawada", "Camp", "Deccan", "Swargate",
            "Katraj", "Kondhwa", "NIBM Road", "Undri", "Wanowrie", "Kharadi", "Wagholi", "Pimpri",
            "Chinchwad", "Ravet", "Akurdi"
        ],
        "kolkata": [
            "Park Street", "Salt Lake", "New Town", "Ballygunge", "Howrah", "Dum Dum", "Gariahat",
            "Jadavpur", "Alipore", "Rajarhat", "Behala", "Tollygunge", "Garia", "Barasat", "Lake Town",
            "Ultadanga", "Sealdah", "Esplanade", "BBD Bagh", "Kalighat", "Bhowanipore", "Entally",
            "Tangra", "Topsia"
        ],
        "ahmedabad": [
            "CG Road", "Prahlad Nagar", "SG Highway", "Navrangpura", "Satellite", "Maninagar", "Bopal",
            "Vastrapur", "Ellisbridge", "Thaltej", "Bodakdev", "Ambawadi", "Paldi", "Ashram Road",
            "Sabarmati", "Chandkheda", "Gota", "Motera", "Naranpura", "Memnagar", "Gurukul", "Drive In Road",
            "Science City", "Nikol", "Naroda", "Vastral", "Isanpur", "Odhav"
        ],
        "jaipur": [
            "C-Scheme", "Malviya Nagar", "Vaishali Nagar", "Raja Park", "Mansarovar", "Tonk Road",
            "Bani Park", "Sodala", "Jagatpura", "Ajmer Road", "Pratap Nagar", "Sanganer", "Durgapura",
            "Sitapura", "Vidhyadhar Nagar", "Murlipura", "Jhotwara", "Amer", "Nahargarh"
        ],
        "lucknow": [
            "Hazratganj", "Gomti Nagar", "Aliganj", "Aminabad", "Indira Nagar", "Charbagh", "Alambagh",
            "Mahanagar", "Vikas Nagar", "Rajajipuram", "Aashiyana", "Jankipuram", "Chinhat", "Faizabad Road",
            "Kanpur Road", "Sushant Golf City"
        ],
        "new york": [
            "Manhattan", "Midtown", "SoHo", "Tribeca", "Upper East Side", "Upper West Side", "Harlem",
            "Chelsea", "Greenwich Village", "East Village", "Lower East Side", "Financial District",
            "Hell's Kitchen", "Brooklyn", "Williamsburg", "DUMBO", "Park Slope", "Bushwick",
            "Bedford-Stuyvesant", "Cobble Hill", "Crown Heights", "Flatbush", "Bay Ridge", "Sunset Park",
            "Queens", "Astoria", "Long Island City", "Flushing", "Jackson Heights", "Elmhurst",
            "Forest Hills", "Bronx", "South Bronx", "Fordham", "Pelham Bay", "Riverdale", "Staten Island"
        ],
        "london": [
            "Shoreditch", "Camden", "Soho", "Covent Garden", "Mayfair", "Kensington", "Chelsea",
            "Notting Hill", "Brixton", "Hackney", "Islington", "Dalston", "Peckham", "Greenwich",
            "Canary Wharf", "Westminster", "Fulham", "Hammersmith", "Wimbledon", "Croydon", "Stratford",
            "Walthamstow", "Tottenham", "Ealing", "Richmond", "Battersea"
        ],
        "dubai": [
            "Downtown Dubai", "Dubai Marina", "JBR", "JLT", "Business Bay", "DIFC", "Deira", "Bur Dubai",
            "Al Barsha", "Jumeirah", "Karama", "Satwa", "Al Quoz", "Motor City", "Sports City",
            "International City", "Silicon Oasis", "Academic City", "Discovery Gardens", "Palm Jumeirah",
            "Arabian Ranches"
        ],
        "singapore": [
            "Orchard Road", "Marina Bay", "Chinatown", "Little India", "Bugis", "Clarke Quay",
            "Tiong Bahru", "Katong", "Jurong East", "Tampines", "Woodlands", "Ang Mo Kio", "Toa Payoh",
            "Bishan", "Clementi", "Bukit Timah", "Holland Village", "Dhoby Ghaut", "Lavender", "Geylang"
        ]
    }
    
    # Return matched city or fallback format
    for key in locations:
        if key in city or city in key:
            return locations[key]
            
    c = city.title()
    return [
        f"North {c}", f"South {c}", f"East {c}", f"West {c}", f"Central {c}", 
        f"{c} Market Area", f"{c} Main Road", f"{c} Station Area", f"{c} Old Town", f"{c} New Town"
    ]
