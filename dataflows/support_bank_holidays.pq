[StagingDefinition = [Kind = "FastCopy"]]
section Section1;
shared support_bank_holidays = let
    Source = Json.Document(Web.Contents("https://www.gov.uk/bank-holidays.json")),
    #"Converted to List" = Record.ToList(Source),
    #"Converted to Table" = Table.FromRecords(#"Converted to List"),
    #"Changed Type" = Table.TransformColumnTypes(#"Converted to Table",{{"division", type text}, {"events", type any}}),
    events = #"Changed Type"{0}[events],
    #"Converted to Table1" = Table.FromList(events, Splitter.SplitByNothing(), null, null, ExtraValues.Error),
    #"Expanded Column1" = Table.ExpandRecordColumn(#"Converted to Table1", "Column1", {"title", "date", "notes", "bunting"}, {"title", "date", "notes", "bunting"}),
    #"Changed Type1" = Table.TransformColumnTypes(#"Expanded Column1",{{"date", type date}}),
    #"Renamed Columns" = Table.RenameColumns(#"Changed Type1",{{"date", "date"}}),
    #"Removed Other Columns" = Table.SelectColumns(#"Renamed Columns",{"date"})
in
    #"Removed Other Columns";
