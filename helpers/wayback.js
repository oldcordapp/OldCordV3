const fetch = require('node-fetch');

const wayback = {
    convertTimestampToCustomFormat: (timestamp) => {
        const dateObject = new Date(timestamp);
  
        const year = dateObject.getUTCFullYear();
        const month = String(dateObject.getUTCMonth() + 1).padStart(2, '0');
        const day = String(dateObject.getUTCDate()).padStart(2, '0');
        const hours = String(dateObject.getUTCHours()).padStart(2, '0');
        const minutes = String(dateObject.getUTCMinutes()).padStart(2, '0');
        const seconds = String(dateObject.getUTCSeconds()).padStart(2, '0');
      
        return `${year}${month}${day}${hours}${minutes}${seconds}`;
    },
    getTimestamps: async (url) => {
        console.log("Fetching");

        try {
            const response = await fetch("https://web.archive.org/web/timemap/link/" + url, {
                headers: {
                    'User-Agent' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
                }
            });
        
            console.log("Fetching");
            
            if (!response || !response.ok || !response.body) {
                return null;
            }

            let first_ts = "0";
            let last_ts = "0";

            let responseTxt = await response.text();
            
            console.log(responseTxt);

            let lines = responseTxt.split('\n');

            for (let line of lines) {
                if (line.toLowerCase().includes("first memento")) {
                    first_ts = line.split('datetime=')[1].split('"')[1].split('"')[0];
                } else if (line.toLowerCase().includes("from=")) {
                    last_ts = line.split('from=')[1].split('"')[1].split('"')[0];
                }
            }

            return {
                first_ts: wayback.convertTimestampToCustomFormat(first_ts),
                last_ts: wayback.convertTimestampToCustomFormat(last_ts)
            };
        }
        catch (err) {
            console.log(err);
            
            return null;
        }
    }
};

module.exports = wayback;