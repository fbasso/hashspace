
/*
 * Copyright 2012 Amadeus s.a.s.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Hash Space runtime

require("hsp/es5");
var klass=require("hsp/klass"),
	TNode=require("hsp/rt/tnode").TNode, 
	doc=require("hsp/document"),
	rt=require("hsp/rt/$root"), 
	$RootNode=rt.$RootNode, 
	$InsertNode=rt.$InsertNode;

var NodeGenerator = klass({
	/**
	 * NodeGenerator constructor
	 * @param {Array|TNode} nodedefs tree root of node generators created by the template pre-processor
	 */
	$constructor:function(nodedefs) {
		this.nodedefs=nodedefs;
	},

	/**
	 * Main method called to generate the document fragment associated to a template for a given set of arguments
	 * This creates a new set of node instances from the node definitions passed in the ng constructor
	 * @param {Array} scopevars the list of the scope variables (actually the template arguments) - e.g. ["person",person]
	 *                odd indexes correspond to argument values / even indexes correspond to argument names
	 */
	process:function(tplctxt, scopevars) {
		var vs={}, nm, argNames=[]; // array of argument names
		if (scopevars) {
			for (var i=0, sz=scopevars.length;sz>i;i+=2) {
				nm=scopevars[i];
				vs[nm]=scopevars[i+1]; // feed the vscope
				argNames.push(nm);
			}
		} 
		vs["#scope"]=vs; // self reference (used for variables - cf. expression handler)
						
		var root=null;
		if (tplctxt.$constructor && tplctxt.$constructor===$InsertNode) {
			// we use the insert node as root node
			root=tplctxt;
			root.init(vs, this.nodedefs, argNames);
		} else {
			root=new $RootNode(vs, this.nodedefs, argNames, module);
		}

		return root;
	}
});

var tplRefresh=[]; 		// List of templates pending refresh
var tplTimeoutId=null;	// Timer id to trigger refresh automatically

/**
 * Refresh method that automatically refreshes all templates that may haven
 * been impacted by changes in data structures
 * This method is automatically triggered by a setTimeout and doesn't need to be
 * explicitelly called
 **/
var refresh = module.exports.refresh = function() {
	var t;
	if (tplTimeoutId) {
		clearTimeout(tplTimeoutId);
		tplTimeoutId=null;
	}
	while(t=tplRefresh.shift()) {
		t.refresh();
	}
}

var refreshTimeout=function() {
	tplTimeoutId=null;
	refresh();
}

/**
 * Add a template to the list of templates that must be refreshed when all changes are 
 * done in the data structures. This is automatically called by the template $Root node
 * (cf. TNode.onPropChange())
 **/
refresh.addTemplate=function(tpl) {
	var idx=tplRefresh.indexOf(tpl);
	if (idx<0) {
		tplRefresh.push(tpl);
		if (!tplTimeoutId) {
			tplTimeoutId=setTimeout(refreshTimeout,0);
		}
	}
}


/**
 * Display a template inside an HTML container
 * sample usage: hsp.display(myTemplate(param1,param2),"mydiv");
 * @param {$RootNode} tplResult the template node generated by a template
 * @param {string|DOMElement} container the HTML container element or its id
 * @param {Boolean} replace if true, the template result will replace the element content - otherwise it will be appended (default: true)
 **/
module.exports.display = function(tplResult, container, replace) {
	// TODO - Validate argument types / implement nice error messages
	var c=container;
	if (typeof(container==="string")) {
		c=doc.getElementById(container);
	}
	if (c && tplResult) {
		if (tplResult.appendToDOM===undefined || tplResult.appendToDOM.constructor!==Function) {
			throw new Error("[hsp.display] Invalid argument: tplResult is not a valid template result");
		} else {
			if (replace!==false) {
				// remove previous content
				c.innerHTML="";
			}
			tplResult.appendToDOM(c);
		}
	}
}

/**
 * Helper to create template functions
 * @param {Array} argNames the list of argument names - e.g. ["label", "value"]
 * @param {Function} contentFunction a function returning the structure of the template
 * e.g. function(n) { return [n.$text({e1:[0,0,"label"],e2:[1,0,"value"]},["",1,": ",2])] }
 */
module.exports.template = function(argNames, contentFunction) {
	// closure variables
	var ng=new NodeGenerator(null), args=[], sz=argNames.length;
	for (var i=0;sz>i;i++) {
		args.push(argNames[i]);
		args.push(null);
	}

	var f=function() {
		if (!ng.nodedefs) {
			ng.nodedefs=contentFunction(nodes);
		}

		for (var i=0;sz>i;i++) {
			args[1+2*i]=arguments[i];
		}
		return ng.process(this,args);
	}
	f.isTemplate=true;
	return f;
}

var loggers=null;
/**
 * Adds a logger to the logger collection. When a template error is to be logged by hashspace, it will first delegate
 * to the loggers in the logger collection. When a logger handles the error it should return false to prevent errors to be handled
 * by other loggers
 * @param {Function} logger the logger function with the following signature ({String} fileName, {Array} errors) -> Boolean
 */
module.exports.useLogger=function(logger) {
	if (!loggers) {
		loggers=[];
	}
	loggers.push(logger);
}

/**
 * Helper function used by the hashspace compiler to insert errors in the generated scripts when invalid
 */
module.exports.logErrors = function(fileName,errors) {
	var goahead=true;
	if (loggers && loggers.length) {
		var lsz=loggers.length, res;
		for (var i=0;lsz>i;i++) {
			res=loggers[i](fileName,errors);
			if (res===false) {
				// stop processing
				goahead=false;
				break;
			}
		}
	}
	if (goahead) {
		var sz=errors.length, err, msg, code;
		for (var i=0;sz>i;i++) {
			err=errors[i];
			if (err.lineInfoTxt) {
				code="\r\n>> "+err.lineInfoTxt.replace(/\r?\n/gi,"\r\n>> ");
			} else if (err.code) {
				code="\r\n>> "+err.code;
			}
			msg=[
				'Error in [', fileName ,']\r\n>> ',
				err.description, '(line: ', err.line, ',column: ', err.column, ')', code
			].join('');
			console.error(msg);
		}
	}
} 

/**
 * Collection of the node types supported by the NodeGenerator
 * This collection is attached to the Nodegenerator constructor through a nodes property
 */
var nodes={}

var nodeList=[
	"$text",require("hsp/rt/$text"),
	"$if",require("hsp/rt/$if"),
	"$insert",$InsertNode,
	"$foreach",require("hsp/rt/$foreach"),
	"elt",require("hsp/rt/eltnode")
]

for (var i=0, sz=nodeList.length;sz>i;i+=2) {
	createShortcut(nodeList[i],nodeList[i+1]);
}

/**
 * Create shortcut functions on the nodes collection to simplify the template functions
 * e.g.
 * nodes.$text=function(exps, textcfg) {return new $TextNode(exps, textcfg);}
 */
function createShortcut(tagName,tagConstructor) {
	nodes[tagName]=function(a1,a2,a3,a4,a5,a6) {return new tagConstructor(a1,a2,a3,a4,a5,a6);}
}
