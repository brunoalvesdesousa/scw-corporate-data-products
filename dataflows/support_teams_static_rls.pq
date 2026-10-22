[StagingDefinition = [Kind = "FastCopy"]]
section Section1;
shared teams_rls_static = let
  Source = SharePoint.Files("https://nhs.sharepoint.com/sites/msteams_7026cb-P00278SmartTimeDataQualityReporting/", [ApiVersion = 15]),
  Navigation = Source{[Name = "rls_static.xlsx", #"Folder Path" = "https://nhs.sharepoint.com/sites/msteams_7026cb-P00278SmartTimeDataQualityReporting/Shared Documents/P00278 SmartTime Data Quality Reporting/Supporting Docs/"]}[Content],
  #"Imported Excel workbook" = Excel.Workbook(Navigation, null, true),
  #"Navigation 1" = #"Imported Excel workbook"{[Item = "rls_static", Kind = "Sheet"]}[Data],
  #"Promoted headers" = Table.PromoteHeaders(#"Navigation 1", [PromoteAllScalars = true]),
  #"Replaced errors" = Table.ReplaceErrorValues(#"Promoted headers", {{"Access CostCentre", ""}}),
  #"Changed column type" = Table.TransformColumnTypes(#"Replaced errors", {{"Access CostCentre", type text}, {"Access Level3", type text}, {"Access L4", type text}, {"Access Level6", type text}, {"PersonFk", Int64.Type}, {"NameFirst", type text}, {"NameLast", type text}, {"Email", type text}, {"supervisorId", Int64.Type}, {"supervisor", type text}, {"Id", Int64.Type}, {"scwcsu email", type text}, {"full_name", type text}, {"pg group", type text}}),
  #"Removed other columns" = Table.SelectColumns(#"Changed column type", {"Access CostCentre", "Access Level3", "Access L4", "Access Level6", "PersonFk", "NameFirst", "NameLast", "Email", "supervisorId", "supervisor", "Id", "scwcsu email", "full_name", "pg group"}),
  #"Replaced value" = Table.ReplaceValue(#"Removed other columns", null, "", Replacer.ReplaceValue, {"Access CostCentre", "Access Level3", "Access L4", "Access Level6", "PersonFk", "NameFirst", "NameLast", "Email", "supervisorId", "supervisor", "Id", "scwcsu email", "full_name", "pg group"})
in
  #"Replaced value";
