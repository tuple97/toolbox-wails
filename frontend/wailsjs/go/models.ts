export namespace app {
	
	export class AppInfo {
	    name: string;
	    version: string;
	    goVersion: string;
	    platform: string;
	    arch: string;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.goVersion = source["goVersion"];
	        this.platform = source["platform"];
	        this.arch = source["arch"];
	    }
	}

}

export namespace database {
	
	export class DBConnection {
	    id: number;
	    name: string;
	    dbType: string;
	    host: string;
	    port: number;
	    database: string;
	    username: string;
	    password: string;
	    extra: string;
	
	    static createFrom(source: any = {}) {
	        return new DBConnection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.dbType = source["dbType"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.database = source["database"];
	        this.username = source["username"];
	        this.password = source["password"];
	        this.extra = source["extra"];
	    }
	}
	export class Dictionary {
	    id: number;
	    name: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new Dictionary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	    }
	}
	export class DictionaryItem {
	    id: number;
	    dictionaryId: number;
	    value: string;
	    meaning: string;
	    description: string;
	    sortOrder: number;
	
	    static createFrom(source: any = {}) {
	        return new DictionaryItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.dictionaryId = source["dictionaryId"];
	        this.value = source["value"];
	        this.meaning = source["meaning"];
	        this.description = source["description"];
	        this.sortOrder = source["sortOrder"];
	    }
	}
	export class SQLTemplate {
	    id: number;
	    connId: number;
	    name: string;
	    sqlText: string;
	    variables: string;
	    fieldMappings: string;
	    preScript: string;
	    postScript: string;
	
	    static createFrom(source: any = {}) {
	        return new SQLTemplate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.connId = source["connId"];
	        this.name = source["name"];
	        this.sqlText = source["sqlText"];
	        this.variables = source["variables"];
	        this.fieldMappings = source["fieldMappings"];
	        this.preScript = source["preScript"];
	        this.postScript = source["postScript"];
	    }
	}
	export class Setting {
	    key: string;
	    type: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new Setting(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.type = source["type"];
	        this.value = source["value"];
	    }
	}
	export class Tab {
	    id: number;
	    name: string;
	    sortOrder: number;
	    isActive: boolean;
	    isLocked: boolean;
	    toolType: string;
	    payload: string;
	    schemaVersion: number;
	
	    static createFrom(source: any = {}) {
	        return new Tab(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.sortOrder = source["sortOrder"];
	        this.isActive = source["isActive"];
	        this.isLocked = source["isLocked"];
	        this.toolType = source["toolType"];
	        this.payload = source["payload"];
	        this.schemaVersion = source["schemaVersion"];
	    }
	}

}

export namespace services {
	
	export class ColumnMeta {
	    name: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new ColumnMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	    }
	}
	export class ExecuteRequest {
	    connId: number;
	    sqlTemplate: string;
	    variables: Record<string, any>;
	    preScript: string;
	    postScript: string;
	
	    static createFrom(source: any = {}) {
	        return new ExecuteRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connId = source["connId"];
	        this.sqlTemplate = source["sqlTemplate"];
	        this.variables = source["variables"];
	        this.preScript = source["preScript"];
	        this.postScript = source["postScript"];
	    }
	}
	export class QueryResult {
	    columns: ColumnMeta[];
	    rows: any[];
	    sql: string;
	    elapsedMs: number;
	    rowCount: number;
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new QueryResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = this.convertValues(source["columns"], ColumnMeta);
	        this.rows = source["rows"];
	        this.sql = source["sql"];
	        this.elapsedMs = source["elapsedMs"];
	        this.rowCount = source["rowCount"];
	        this.truncated = source["truncated"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TemplateListItem {
	    id: number;
	    name: string;
	    connId: number;
	    sqlText: string;
	
	    static createFrom(source: any = {}) {
	        return new TemplateListItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.connId = source["connId"];
	        this.sqlText = source["sqlText"];
	    }
	}

}

