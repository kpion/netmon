
/**
 * some common stuff shared among application elelements like background, content, action scripts.
 * and the inzoom itself (indirectly) 
 * 
 * including 'defaultConfig' which actually might go somewhere else.
 */
const app =  {
    /*
    default configuration, this will be saved to storage.local and from now on will be used from there.
    except for testing the files outside an extension - this is the only source of config values then.
    This key will be saved to the storage.local (or similar)
    */     
    defaultConfig: {

    },

    evnironment : 'dev',//'prod' or 'dev'.

    isDev : function(){
        return (this.evnironment && this.evnironment.toUpperCase()  == 'DEV');
    },
};

/**
 * Logger: a console.log which can be globally enabled/disabled, with a prefix
 * **and** showing the right file and line number in console (i.e. wherever the function was called)
 * 
 * Usage example: 
 * 
 * var logger = new Logger('module xyz:');
 * logger.log('blah');
 * 
 * or enabled/disabled depending on environment (dev/prod):
 * var logger = new Logger('module xyz:',app.isDev());
 * 
 * the above will output module xyz: blah and report the right file and line number 
 */
class Logger{
	constructor(prefix = '', enabled = true){
        if(!enabled){
            this.log = function(){};
            return;
        }        
        this.log = function() {
            return Function.prototype.bind.call(console.log, console, prefix);
        }();
	}
}

/**
 * just a request and a matching response
 */
class Entry{

	constructor(){
        //request and reponse come directly from browser
        this.request = this.response = {};
        //'extra' is something this app fills.
        this.extra = {
            
            //*some* information from the tab making the request, at the time it is making it.
            //mainly we have the .url here. Or at least should have, this isn't critically important
            //for background.js to grab it.
            tab: {},

            //here we're just using request timestamp and response timestamp to calculate the difference.
            //which basically should be a 'server reponse time' or rather 'download time'. 
            //For some reason it is a bit different than what we see in dev tools -> network, 
            //but this measurement can still be good when comparing to other requests' times reported 
            //by this extension. It's just comparing it to other tools and methods might bring different 
            //results.
            time: null,
        };
	}	
}
