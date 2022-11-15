const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');

const secondsAgo = () => {
  let date = new Date();
  date.setSeconds(date.getSeconds() - 30);
  return date.toISOString();
}

const serverUrl = (process.env.NODE_ENV === 'production') 
  ? 'https://www.mydomain.com'
  : 'http://localhost:8080';

const bearerClient = new TwitterApi(`${process.TWITTER_BEARER_TOKEN}`);

const allParams = {
  expansions: ['author_id','in_reply_to_user_id','referenced_tweets.id', 'attachments.media_keys', 'attachments.poll_ids', 'entities.mentions.username', 'geo.place_id', 'referenced_tweets.id.author_id'],
  'tweet.fields': ['public_metrics', 'author_id', 'conversation_id', 'created_at', 'in_reply_to_user_id', 'referenced_tweets', 'attachments', 'geo', 'id', 'context_annotations', 'possibly_sensitive', 'source', 'withheld'],
  'user.fields': ['created_at', 'description', 'entities', 'id', 'location', 'name', 'pinned_tweet_id', 'profile_image_url', 'protected', 'public_metrics', 'url', 'username', 'verified', 'withheld'],
  'media.fields': ['duration_ms', 'height', 'media_key', 'type', 'url', 'width', 'public_metrics', 'alt_text'],
  'place.fields': ['contained_within', 'country', 'country_code', 'full_name', 'geo', 'id', 'name', 'place_type']
}

const userFields = {
  'user.fields': ['created_at', 'description', 'entities', 'id', 'location', 'name', 'pinned_tweet_id', 'profile_image_url', 'protected', 'public_metrics', 'url', 'username', 'verified', 'withheld'],
}


module.exports = function(app) {

app.post('/twitter/ratio/tweet', (req, res, next) => {

  let tweetId = req.body.query;

  let origAuthor;
  let origTweet;
  let origMetrics;

  //find tweet
  axios({
    method: "POST", 
    url: `${serverUrl}/twitter/user/tweet`, 
    data: {query: tweetId}
  }).then((response)=> {
    if (response.data === 'Error') {res.send('Error') } else {
      
    //get metrics
    origTweet = response.data.data;
    origMetrics = origTweet.public_metrics;
    console.log(response.data.data);
    
      
    //get author of original tweet
    axios({
      method: "POST", 
      url: `${serverUrl}/twitter/user`, 
      data: {query: origTweet.author_id}
    }).then((response)=> {
      origAuthor = response.data.data;
    }).catch(err => { console.log(err) });  
    
    
    //get replies
    axios({
      method: "POST", 
      url: `${serverUrl}/twitter/search/recent`, 
      data: {
        query: `conversation_id:${origTweet.conversation_id}`, 
        startTime: response.data.data.created_at
      }
    }).then((response)=> {

      if (response.data === 'Error') {res.send('Error')}

      else if (!response.data._realData.data) {
        //if no replies
        res.send('No Replies');
      }
      
      else {
        let replies = response.data._realData.data;

        //start an array for promises
        let promises = [];

        //iterate thorough replies, get authors and compare metrics
        for (let i = 0; i < replies.length; i++) {
          //if tweet is reply to user and the like count is lower than the quote tweet, replies, like on a reply, start a request for the author info and push the promise to the array
          if (replies[i].in_reply_to_user_id === origTweet.author_id && (origMetrics.like_count < replies[i].public_metrics.like_count || 
            origMetrics.like_count < replies[i].public_metrics.quote_count ||
            origMetrics.like_count * 1.25 < replies[i].public_metrics.reply_count ||
            origMetrics.like_count < replies[i].public_metrics.retweet_count
          )) {
            let reply = replies[i];
            promises.push(axios({
              method: "POST", 
              url: `${serverUrl}/twitter/user`, 
              data: {query: reply.author_id}
            }).then((response)=> {
              if (response.data === 'Error') {res.send('Error')};
              return {tweet: reply, author: response.data.data};
            }).catch(err => { console.log(err);}))
          }
        }

        //wait for all promises (ratios) to resolve before sending the final result
        Promise.all(promises).then((ratios) => {
          res.send({author: origAuthor, tweet: origTweet, ratios: ratios});
        });

      };

    }).catch(err => { console.log(err); })}
    
  }).catch(err => { console.log(err);  
    console.log(err.data.errors);
    console.log(err.data.errors[0].parameters);
});
});

app.post('/twitter/search/recent', async (req, res) => {

  let query = req.body.query;

  let startTime = req.body.startTime; 
  //the end time parameter of the search must be more than 30 seconds ago
  let endTime = req.body.endTime ? req.body.endTime : secondsAgo();

  const replies = await bearerClient.v2.search(query, {...allParams, max_results: 100, start_time: startTime, end_time: endTime}).catch(e => {
    res.send('Error');
  });
    
  while (replies && !replies.done) {
    //request to the API returns maximum 10 tweets, this continue pagination to fetch all replies
    await replies.fetchLast();
  }

  if (replies) {
    //wait for all replies to be found, the send the data
    Promise.all(replies).then((response) => {
      res.send(replies);
    });
  } 

});

app.post('/twitter/user', (req, res, next) => {

  let userId = req.body.query;

  bearerClient.v2.user(userId, userFields).then((response) => {
    res.send(response);
  }).catch((err) => {
    console.log(err.data.errors);
    console.log(err.data.errors[0].parameters);
    res.send('Error');
  }); 

});

app.post('/twitter/user/tweet', (req, res, next) => {

  let tweetId = req.body.query;

  bearerClient.v2.singleTweet(tweetId, allParams).then((response) => {
    if (response.errors) {
      res.send('Error');
    } else {
      res.send(response);
    }

  }).catch((err) => {
    console.log(err.data.errors);
    res.send('Error');
  });

});

}

