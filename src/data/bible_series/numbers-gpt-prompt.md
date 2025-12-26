I am working on building a structured JSON file based on some data in a google file. I need to translate the data in the file to the structured format. It is for a bible engagement application where on each day, the user can ready, listen, reflect or pray. The series spans from October 6 to to November 28 2025. I have constructed the file for the first day. Here it is:

```
{
  "bible_series": {
    "title": "Numbers",
    "sub_title": "",
    "image_gs_location": "gs://wpa-be-app.appspot.com/bible_series/numbers/NUMBERS.jpg",
    "is_active": false,
    "is_visible": false
  },
  "series_content": [
    {
      "title": "",
      "content_type": "read",
      "date": "2025-10-06",
      "body": [
        {
          "attribution": "Copyright © 1973 1978 1984 2011 by Biblica, Inc. TM\nUsed by permission. All rights reserved worldwide",
          "bible_version": "Scripture quotations taken from The Holy Bible, New International Version® NIV®",
          "body_type": "scripture",
          "scriptures": [
            {
              "book": "Numbers",
              "chapter": "1",
              "title": "",
              "verses": {
                "1": "The LORD spoke to Moses in the Tent of Meeting in the Desert of Sinai on the first day of the second month of the second year after the Israelites came out of Egypt. He said:",
                "2": "\"Take a census of the whole Israelite community by their clans and families, listing every man by name, one by one.",
                "3": "You and Aaron are to number by their divisions all the men in Israel twenty years old or more who are able to serve in the army.",
                "4": "One man from each tribe, each the head of his family, is to help you.",
                "5": "These are the names of the men who are to assist you: from Reuben, Elizur son of Shedeur;",
                "6": "from Simeon, Shelumiel son of Zurishaddai;",
                "7": "from Judah, Nahshon son of Amminadab;",
                "8": "from Issachar, Nethanel son of Zuar;",
                "9": "from Zebulun, Eliab son of Helon;",
                "10": "from the sons of Joseph: from Ephraim, Elishama son of Ammihud; from Manasseh, Gamaliel son of Pedahzur;",
                "11": "from Benjamin, Abidan son of Gideoni;",
                "12": "from Dan, Ahiezer son of Ammishaddai;",
                "13": "from Asher, Pagiel son of Ocran;",
                "14": "from Gad, Eliasaph son of Deuel;",
                "15": "from Naphtali, Ahira son of Enan.\"",
                "16": "These were the men appointed from the community, the leaders of their ancestral tribes. They were the heads of the clans of Israel.",
                "17": "Moses and Aaron took these men whose names had been given,",
                "18": "and they called the whole community together on the first day of the second month. The people indicated their ancestry by their clans and families, and the men twenty years old or more were listed by name, one by one,",
                "19": "as the LORD commanded Moses. And so he counted them in the Desert of Sinai."
              }
            }
          ]
        }
      ]
    },
    {
      "title": "",
      "content_type": "listen",
      "date": "2025-10-06",
      "body": [
        {
          "paragraphs": [
            "Tap below to listen to Numbers 1:1-19"
          ],
          "body_type": "text"
        },
        {
          "text": "Numbers 1:1-19",
          "link": "",
          "body_type": "link"
        }
      ]
    },
    {
      "title": "",
      "content_type": "reflect",
      "date": "2025-10-06",
      "body": [
        {
          "paragraphs": [
            "Read through Numbers 1:1-19 and reflect on the questions below."
          ],
          "body_type": "text"
        },
        {
          "body_type": "question",
          "questions": [
            "Scripture: Read Numbers 1:1-19. Look for a verse that was meaningful to you and write it down",
            "Observation: What is God saying to you in this scripture? Ask the Holy Spirit to teach you and reveal Jesus to you. Paraphrase and write this scripture down in your own words.",
            "Application:  Personalize what you have read by asking yourself how it applies to your life right now. Perhaps it is instruction, encouragement, revelation, a new promise or corrections for an area of your life. Write down how this passage applies to you today.",
            "Prayer: This can be as simple as asking God to help you live out the truth from this passage, or it may be seeking God for a greater understanding of what He may reveal to you. Remember, prayer is a two-way conversation, so be sure to listen to what God has to say! Now write it down."
          ]
        }
      ]
    },
    {
      "title": "",
      "content_type": "prayer",
      "date": "2025-10-06",
      "body": [
        {
          "paragraphs": [
            "After reading through Numbers 1:1-19, please pray the following prayer points."
          ],
          "body_type": "text"
        },
        {
          "paragraphs": [
            "- Pray that God will help you to understand that He sees you and knows you by name.",
            "- Pray that you will value all people, for God has numbered and cares for each one.",
            "- Thank God for the gift of your life and for making you part of His family."
          ],
          "body_type": "text"
        }
      ]
    }
  ]
}
```

Here is the raw data:
NUMBERS
Dates: Oct 6 - Nov 28, 2025
Due: Sept 19, 2025

Methods: Read, Listening, Reflect, Prayer 
Anjan: Listening
James: Prayer

REFLECT: Scripture, Observation, Application, Prayer 
Scripture: Read (insert book name, chapter and verses). Look for a verse that was meaningful to you and write it down.
Observation: What is God saying to you in this scripture? Ask the Holy Spirit to teach you and reveal Jesus to you. Paraphrase and write this scripture down in your own words.
Application: Personalize what you have read by asking yourself how it applies to your life right now. Perhaps it is instruction, encouragement, revelation, a new promise or corrections for an area of your life. Write down how this passage applies to you today.
Prayer: This can be as simple as asking God to help you live out the truth from this passage, or it may be seeking God for a greater understanding of what He may reveal to you. Remember, prayer is a two-way conversation, so be sure to listen to what God has to say! Now write it down.

Oct 6
Read: Num. 1:1-19 
Listen: 
Reflect: See format above
Prayer: 
Pray that God will help you to understand that He sees you and knows you by name.
Pray that you will value all people, for God has numbered and cares for each one.
Thank God for the gift of your life and for making you part of His family.
Oct 7
Read: Num. 1:20-54
Listen: 
Reflect:See format above
Prayer:
Pray that you will always have a place of worship at the center of your life.
Ask God to help you accept and belong to the family and community He has placed you in.
Thank God for the gift of your family and the people He has surrounded you with.
Oct 8
Read: Num. 2:1-34
Listen: 
Reflect: See format above
Prayer:
Ask God to help you understand His plan and purpose for your life.
Pray that you will recognize the place of people God has given you — your family, community, and church.
Thank God that He has a plan for you, and that you are never forgotten in His order.
Oct 9
Read: Num. 3:1-39
Listen:  
Reflect:
Prayer:
Pray that God will help you recognize His presence in your life and know how to steward it with reverence.
Pray that God will help you understand your place of service in the gathering of believers.
Thank God for the gift of fellowship at WPA and the community He has placed you in.
Oct 10
Read: Num. 4:1-49
Listen: 
Reflect: See format above
Prayer:
Ask God to help you take serving Him seriously and to honor Him with your service.
Ask God to help you recognize the diversity in His house and treat all people with honor.
Thank God for the privilege of serving Him in His kingdom.
Oct 13
Read: Num. 5:1-31
Listen: 
Reflect: See format above
Prayer:
Pray that you will, by God’s grace, hate evil and love what is good.
Pray that you will not be yoked with the godless, who can mislead you away from His presence.
Thank God for His power at work in you that enables you to resist evil.
Oct 14
Read: Num. 6:1-27
Listen: 
Reflect: See format above
Prayer:
Pray that you will know you have been set apart for good works in Christ.
Pray that you will live a life that is consecrated and devoted to Him.
Thank God that He is Immanuel — God with you, blessing and keeping you each day.
Oct 15
Read: Num. 7:1-47
Listen: 
Reflect: See format above
Prayer:
Pray that you will practice equality in how you treat people from all nations and backgrounds.
Pray that you will live a generous life, giving freely to God and others.
Thank God that He is not partial, but a God of justice and equality for all His people.
Oct 16
Read: Num. 7:48-89
Listen: 
Reflect:
Prayer:
Pray that there will be unity in purpose both in our church and in your family.
Pray that you will clearly understand what God wants you to do specifically in your life.
Thank God for His presence and voice that still speaks to you today.
Oct 17 
Read: Num. 8:1-26
Listen: 
Reflect: See format above
Prayer:
Pray that God’s light will shine through your life wherever you go.
Pray that you will live a pure and consecrated life, ready for God’s service.
Thank God that He has set you apart and given you a place in His work and family.
Oct 20
Read: Num. 9:1-23
Listen: 
Reflect: See format above
Prayer:
Pray that you will always remember God’s salvation and never take it for granted.
Pray that you will follow God’s leading in every step, moving when He says go and waiting when He says stay.
Thank God that His presence goes before you and guides your life.


Oct 21
Read: Num. 10:1-36
Listen: 
Reflect: See format above
Prayer:
Pray that you will always be attentive to God’s call and move when He directs.
Pray for unity and order in your family and church as you journey together.
Thank God that His presence goes before you, scattering obstacles and leading you to rest.





Oct 22
Read: Num. 11:1-35
Listen: 
Reflect: See format above
Prayer:
Pray that you will learn to be content with God’s provision and not crave what leads to destruction.
Pray that God will fill you with His Spirit to serve faithfully and share the burdens of others.
Thank God for His mercy and discipline which guides you into maturity.


Oct 23
Read: Num. 12:1-16
Listen: 
Reflect: See format above
Prayer:
Pray that you will be free from jealousy and pride, honoring those God has placed in leadership.
Pray for a heart of humility and intercession, like Moses, even toward those who wrong you.
Thank God for His mercy that restores, both in your life and in the lives of others.
Oct 24
Read: Num. 13:1-33
Listen: 
Reflect: See format above
Prayer:
Pray that you will have eyes of faith like Caleb and Joshua, trusting God’s promises over fear.
Pray that you will not see yourself as weak, but as God sees you, strong in Him.
Thank God that His promises are sure, even when obstacles look overwhelming.
Oct 27
Read: Num. 14:1-44
Listen: 
Reflect: See format above
Prayer:
Pray that you will trust God’s promises and not be overcome by fear or unbelief.
Pray for the grace to obey God’s timing and not move ahead presumptuously without His presence.
Thank God for His mercy and patience, even when we fail.
Oct 28
Read: Num. 15:1-41
Listen: 
Reflect: See format above
Prayer:
Pray that you will recognize the new life God has given you and live in a way that honors Him.
Pray to live a life of renewing your mind in repentance and humility.
Thank God for His mercy and forgiveness in Christ, who covers your sins and makes you holy.

Oct 29
Read: Num. 16:1-50
Listen: 
Reflect: See format above
Prayer:
Pray for a heart of humility and submission to God’s purpose for your life.
Pray that you will honor God’s appointed leaders and serve faithfully where He has placed you.
Thank God for Jesus Christ, our greater High Priest, who intercedes for us and stands between life and death on our behalf.
Oct 30
Read: Num. 17:1-12
Listen: 
Reflect: See format above
Prayer:
Pray that you will trust God’s order and His choice in leadership, knowing it is for your good.
Pray that your life will bear fruit, showing the power of God’s Spirit at work in you.
Thank God for His faithfulness to protect and defend the people He has called to ministry.




Oct 31
Read: Num. 18:1-32
Listen: 
Reflect: See format above
Prayer:	
Pray that you will recognize the call to serve as special, serious, and requiring full commitment.
Pray that you will be faithful in giving, for the provision and blessing of those who serve in full-time ministry.
Thank God that He Himself is our true inheritance and reward.

Nov 3
Read: Num. 19:1-22
Listen: 
Reflect: See format above
Prayer:
Pray that you will see the greatness of the sacrifice of Jesus that has satisfied the high demands of holiness.
Pray that you will continually look to Jesus, the ultimate sacrifice, for cleansing from sin.
Thank God that through Christ’s blood you are made clean and can enter His presence.

Nov 4
Read: Num. 20:1-29
Listen: 
Reflect: See format above
Prayer:
Pray that you will honor God’s holiness by obeying His Word exactly, not partially.
Pray for humility to accept God’s discipline and to trust His faithfulness even in hard times.
Thank God that His work continues through generations, and that Christ our eternal High Priest never dies.
Nov 5
Read: Num. 21:1-35
Listen: 
Reflect: See format above
Prayer:
Pray that you will trust God in battles and not give in to fear or complaining.
Pray that you will always look to Jesus, lifted up on the cross, for life and healing.
Thank God for His victories and provision that carry you forward on life’s journey.
Nov 6
Read: Num. 22:1-41
Listen: 
Reflect: See format above
Prayer:
Pray that you will trust in God’s blessing and not fear curses, opposition, or the schemes of others.
Pray for a heart free from greed and compromise, obeying only God’s word.
Thank God that He is sovereign and able to defend His people, even turning opposition into protection.

Nov 7
Read: Num. 23:1-30
Listen: 
Reflect: See format above
Prayer:
Pray that you will rest in God’s blessing, knowing no curse or scheme can stand against His word.
Pray that you will trust in God’s unchanging faithfulness, who always keeps His promises.
Thank God that in Christ, you are set apart and secure, called to walk in victory.

Nov 10
Read: Num. 24:1-25
Listen: 
Reflect: See format above
Prayer:
Pray that we will yield to God’s leading in our lives.
Pray that we will embrace Christ as the eternal King who has been given to save the world.
Thank God for His plan of salvation in Christ, as foreshadowed in this text.

Nov 11
Read: Num. 25:1-18
Listen: 
Reflect: See format above
Prayer:
Pray that you will not submit to other gods in our modern day, such as money, pleasure, or secularism.
Pray as you intercede for those in your family and community who do not know Christ, that they may escape eternal punishment.
Thank God for the chances He gives us when we return to Him in repentance.

Nov 12
Read: Num. 26:1-33
Listen: 
Reflect: See format above
Prayer:
Pray that you will see yourself as part of God’s people, counted and called to His purposes.
Pray that you will trust God to raise a new generation in your family and community that will walk in His ways.
Thank God that His plans continue through mercy, even when others fall away.

Nov 13
Read: Num. 26:34-65
Listen: 
Reflect: See format above
Prayer:
Pray that you will walk faithfully with God and not live a purposeless life that comes from being outside His will.
Pray for the attentiveness to trust God’s provision and fairness, knowing He has an inheritance for you.
Thank God that His faithfulness continues through generations, raising up new leaders and new hope.
Nov 14
Read: Num. 27:1-23
Listen: 
Reflect: See format above
Prayer:
Pray that as a church and family you will empower women against cultural trends that oppress them, just as the daughters of Zelophehad were affirmed.
Pray that you will not miss the will of God as Moses did at Meribah.
Thank God for the leaders He anoints for every season, to guide His people forward.


Nov 17
Read: Num. 28:1-31
Listen: 
Reflect: See format above
Prayer:
Pray that you will put God at the center of your daily, weekly, and yearly rhythms.
Pray that your life will be lived as a continual offering of worship, not just in special moments.
Thank God for Jesus, the perfect sacrifice and first fruits, who fulfills all these offerings.

Nov 18
Read: Num. 29:1-40
Listen:
Reflect: See format above
Prayer:
Pray that your life rhythms will center on God, not on worldly schedules.
Pray that you will live in gratitude for Christ’s atonement and eagerly await His return.
Thank God for His commitment to commune with and care for His people eternally.

Nov 19
Read: Num. 30:1-16
Listen: 
Reflect: See format above
Prayer:
Pray that you will be a person of truth and integrity, keeping your word before God and people.
Pray for wisdom and attentiveness in leadership, to guide your family and community 
Thank God that in Christ, all His promises are fulfilled, and He helps us walk faithfully.

Nov 20
Read: Num. 31:1-54
Listen: 
Reflect: See format above
Prayer:
Pray that God will help you to stay focused on Him and not be distracted by the things of the world.
Pray for those who are lost, that they may come to know Christ and be saved.
Thank God for His desire to relate with us and have a relationship with us.

Nov 21
Read: Num. 32:1-42
Listen: 
Reflect: See format above
Prayer:
Pray that there will be unity of purpose in your family and church community.
Pray that you and the community will carry each other’s burdens, not living only for yourselves.
Thank God for your inheritance of being in Christ.
Nov 24
Read: Num. 33:1-20
Listen: 
Reflect: See format above
Prayer:
Pray that you will see God’s hand in every stage of your journey, even in difficult places.
Pray for a heart that remembers both God’s provision and the lessons from past failures.
Thank God that He leads you faithfully step by step toward His promises.
Nov 25
Read: Num. 33:21-56
Listen: 
Reflect: See format above
Prayer: 
Pray that you will finish your journey well, not falling short because of unbelief.
Pray for strength to tear down every idol and compromise that could draw your heart away from God.
Thank God for being concerned even with the small details of your life.

Nov 26
Read: Num. 34:1-29
Listen: 
Reflect: See format above
Prayer:
Pray that you will trust God’s promises, knowing He has set boundaries and blessings for your life.
Pray for wisdom and fairness in leadership, that God’s people may walk in unity.
Thank God that in Christ, you have an eternal inheritance that can never perish or fade.

Nov 27
Read: Num. 35:1-34
Listen: 
Reflect: See format above
Prayer:
Pray that you will uphold justice and mercy in your dealings with others, reflecting God’s character
Pray for leaders in the church and community to act with fairness, wisdom, and compassion.
Thank God for Christ, our High Priest, whose death brings us freedom, mercy, and refuge.


Nov 28
Read: Num. 36:1-13
Listen: 
Reflect: See format above
Prayer:
Pray that you will be faithful in protecting and stewarding the inheritance God has given you in Christ.
Pray for obedience to God’s wisdom and commands, even when they go against cultural expectations.
Thank God that in Christ, you have an eternal inheritance, unshakable and secure.



I need the remaining days in "series_content" populated. For the scriptures, you can leave the "verses" field blank but include everything else. attribution and bible_version is always the same.

<I then included the bible series json as a file on the chat and told it to use this to populate the scripture.like to chat: https://chatgpt.com/share/68de0688-4634-8009-920d-2a94448165e7>