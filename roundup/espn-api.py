import requests

def get_latest_pl_scores():
    # ESPN's public API endpoint for the English Premier League (eng.1)
    url = "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard"
    
    # Adding a user-agent is good practice to prevent basic blocking
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        events = data.get('events', [])
        
        if not events:
            print("No Premier League matches found at the moment.")
            return

        print(f"{'='*60}")
        print(f" LATEST PREMIER LEAGUE SCORES")
        print(f"{'='*60}\n")

        for event in events:
            competition = event['competitions'][0]
            
            # Get Team Names and Scores
            home_team = next(c for c in competition['competitors'] if c['homeAway'] == 'home')
            away_team = next(c for c in competition['competitors'] if c['homeAway'] == 'away')
            
            home_name = home_team['team']['displayName']
            away_name = away_team['team']['displayName']
            home_score = home_team['score']
            away_score = away_team['score']
            
            # Get Match Status (e.g., FT, Half Time, 45', Postponed)
            status = event['status']['type']['detail']
            
            # Print the main scoreline
            print(f"{home_name} {home_score} - {away_score} {away_name}  ({status})")
            
            # Extract Scorers from the 'details' array
            # ESPN puts goals, cards, and subs in this array. We filter for "Goal".
            details = competition.get('details', [])
            for detail in details:
                if detail.get('type', {}).get('text') == "Goal":
                    # The 'description' field usually looks like: "M. Salah (Assisted by T. Alexander-Arnold) - 45'"
                    scorer_info = detail.get('description', 'Goal scored')
                    
                    # Determine which team scored based on the 'team' object in the detail
                    scoring_team = detail.get('team', {}).get('abbreviation', '???')
                    
                    # Format slightly to indicate home/away
                    if scoring_team == home_team['team']['abbreviation']:
                        print(f"  ⚽ (H) {scorer_info}")
                    else:
                        print(f"  ⚽ (A) {scorer_info}")
            
            print("-" * 60)

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data: {e}")

if __name__ == "__main__":
    get_latest_pl_scores()