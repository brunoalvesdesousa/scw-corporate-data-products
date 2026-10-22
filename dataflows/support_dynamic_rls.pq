[StagingDefinition = [Kind = "FastCopy"]]
section Section1;
shared support_entraid_users = let
    // 1. Define the initial URL
    BaseUrl = "https://graph.microsoft.com/v1.0/users?$top=999",
    
    // 2. The recursive function to fetch all pages
    GetPages = (url) =>
        let
            // Fetch the current page
            Source = Json.Document(Web.Contents(url)),
            // Extract the data (the 'value' list)
            Data = Source[value],
            // Check if there is a next page link
            NextLink = try Source[#"@odata.nextLink"] otherwise null,
            // If next link exists, call the function again and combine lists
            Result = if NextLink <> null then List.Combine({Data, @GetPages(NextLink)}) else Data
        in
            Result,

    // 3. Trigger the function
    AllUsersList = GetPages(BaseUrl),
    
    // 4. Convert the final list back to a table
    TableFromList = Table.FromList(AllUsersList, Splitter.SplitByNothing(), null, null, ExtraValues.Error),
  #"Expanded Column1" = Table.ExpandRecordColumn(TableFromList, "Column1", {"businessPhones", "displayName", "givenName", "jobTitle", "mail", "mobilePhone", "officeLocation", "preferredLanguage", "surname", "userPrincipalName", "id"}, {"businessPhones", "displayName", "givenName", "jobTitle", "mail", "mobilePhone", "officeLocation", "preferredLanguage", "surname", "userPrincipalName", "id"}),
  #"Changed column type" = Table.TransformColumnTypes(#"Expanded Column1", {{"mail", type text}}),
  #"Removed columns" = Table.RemoveColumns(#"Changed column type", {"businessPhones", "preferredLanguage"}),
  #"Changed column type 1" = Table.TransformColumnTypes(#"Removed columns", {{"displayName", type text}, {"givenName", type text}, {"jobTitle", type text}, {"mobilePhone", type text}, {"officeLocation", type text}, {"surname", type text}, {"userPrincipalName", type text}, {"id", type text}})
in
    #"Changed column type 1";
shared support_entraid_groups = let
    // 1. Target the Groups endpoint with max page size
    BaseUrl = "https://graph.microsoft.com/v1.0/groups?$top=999",
    
    // 2. Recursive function to hunt down every page
    GetPages = (url) =>
        let
            Source = Json.Document(Web.Contents(url)),
            // Extract the 'value' (this is the list of groups)
            Data = Source[value],
            // Look for the next page link
            NextLink = try Source[#"@odata.nextLink"] otherwise null,
            // If it exists, go deeper; if not, we're done
            Result = if NextLink <> null then List.Combine({Data, @GetPages(NextLink)}) else Data
        in
            Result,

    // 3. Execute the crawl
    AllGroupsList = GetPages(BaseUrl),
    
    // 4. Transform the resulting list into a usable Table
    TableFromList = Table.FromList(AllGroupsList, Splitter.SplitByNothing(), null, null, ExtraValues.Error),
    
    // 5. Expand the Record to see the actual Group properties (Display Name, ID, etc.)
    #"Expanded Column1" = Table.ExpandRecordColumn(TableFromList, "Column1", {"id", "displayName", "description", "groupTypes", "mailEnabled", "securityEnabled"}, {"id", "displayName", "description", "groupTypes", "mailEnabled", "securityEnabled"}),
  #"Expanded groupTypes" = Table.ExpandListColumn(#"Expanded Column1", "groupTypes"),
  #"Changed column type" = Table.TransformColumnTypes(#"Expanded groupTypes", {{"id", type text}, {"displayName", type text}, {"description", type text}, {"groupTypes", type text}, {"mailEnabled", type logical}, {"securityEnabled", type logical}})
in
    #"Changed column type";
shared support_rls_dynamic = let
    Source = Sql.Databases("CSU-000-SP03"),
    SWCSUDataReporting = Source{[Name="SWCSUDataReporting"]}[Data],
    dbo_vw_StaffHierarchy = SWCSUDataReporting{[Schema="dbo",Item="vw_StaffHierarchy"]}[Data],
    #"Merged Queries" = Table.FuzzyNestedJoin(dbo_vw_StaffHierarchy, {"Email"}, support_entraid_users, {"mail"}, "support_entraid_users", JoinKind.LeftOuter, [IgnoreCase = true, IgnoreSpace = true]),
    #"Changed Type" = Table.TransformColumnTypes(#"Merged Queries",{{"PersonFk", type text}, {"SupervisorId", type text}}),
  #"Expanded support_entraid_users" = Table.ExpandTableColumn(#"Changed Type", "support_entraid_users", {"userPrincipalName"}, {"userPrincipalName"}),
  #"Filtered rows" = Table.SelectRows(#"Expanded support_entraid_users", each ([Leaver] = 0)),
    #"Removed Duplicates" = Table.Distinct(#"Filtered rows", {"PersonFk"}),
  #"Filtered rows 1" = Table.SelectRows(#"Removed Duplicates", each [PersonFk] <> "3207")
in
    #"Filtered rows 1";
shared support_rls_dynamic_missing = let
    Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("pVTbbtswDP0VIQ+7AF0QJ/HtbVldLF2bNasDbEDRB8YmIqGKVMiS0+zrJypbLi2GGiggm7Klc3hEUry76zn1oPRG9c56fhw+4jyJvJmJigNKPyucUrjb5cdoOPbv76LSElnp1mi4kHK/TOP+7L/kwywmeAGtqL291RsJqm4O7NFw6M21UDVs2bV4RGu7cidRRNgrEASZgmlxuwcO8wE5niJYjobNnKy1Vp2p82xAssAZ2Mk/Ys7S5N8aO1l5hXQ0jEnvT1Q1YWZgGg5HoRxnKUn+prliN+/Ptc9C90AnSZaFAC/RUDjmWkow9R6bJDGpvlivgU2d5WC6xzlJiXqiaoObcHK12gOzNM2pPrTUW9Fo9sstoTtxHpMmKX7DEi0P3BuDqsIj3RnpnovHR2BfDWL3HB5OTIXw7MxxnEW7uuZaQsNu9QpN0537oMrbU11vCckzWSGjJ8KSNKYNBS61Ac6mvvh5Z9Un2HBnjtFJPqJ0TCQ+sYsWVOdoZNGuQBpe734cZm8X/SyafnoSz9dFXyqLKwMWa+a7gbScvWPnYHwzQ9OKCv8iLss5+8Qup6V//wh+w239gk+UYHe45dk4dJYZWN9ZNmzhqgc0L7wWYiUsSN8gLHiHC6y48kdYEU+UF8mYyIsCFqy8XvSoOQxSb0qLbSiliZNroEkT/vQhfH9WvOkrpDKmgI7T0F1LsdaKldaZFYYeN/LPh3J+Mbliixt2df6RTSorWmG3bAYKfEH5QxYoRYtm67XB2gMGL5w11aZqXJ98uofe/f0f", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [Level3 = _t, CostCentre = _t, Level6 = _t, PersonFk = _t, NameFirst = _t, NameLast = _t, Email = _t, IsSupervisor = _t, SupervisorId = _t, Supervisor = _t, Id = _t, Name = _t, Leaver = _t, userPrincipalName = _t]),
    #"Changed Type" = Table.TransformColumnTypes(Source, {{"Level3", type text}, {"CostCentre", type text}, {"Level6", type text}, {"PersonFk", type text}, {"NameFirst", type text}, {"NameLast", type text}, {"Email", type text}, {"IsSupervisor", type text}, {"SupervisorId", type text}, {"Supervisor", type text}, {"Id", type text}, {"Name", type text}, {"Leaver", Int64.Type}})
in
    #"Changed Type";
shared support_rls_dynamic_merged = let
    Source = Table.Combine({support_rls_dynamic, support_rls_dynamic_missing}),
    #"Changed Type" = Table.TransformColumnTypes(Source,{{"PersonFk", Int64.Type}, {"SupervisorId", Int64.Type}}),
    #"Removed Duplicates" = Table.Distinct(#"Changed Type", {"PersonFk"}),
    #"Changed Type1" = Table.TransformColumnTypes(#"Removed Duplicates",{{"PersonFk", type text}, {"SupervisorId", type text}}),
  #"Lowercased text" = Table.TransformColumns(#"Changed Type1", {{"userPrincipalName", each Text.Lower(Text.From(_)), type nullable text}}),
  #"Changed column type" = Table.TransformColumnTypes(#"Lowercased text", {{"Leaver", Int64.Type}})
in
    #"Changed column type";
